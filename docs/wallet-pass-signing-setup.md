# Apple Wallet Pass Signing — Setup & Runbook

How the web app signs `.pkpass` files (member cards, event tickets, donation
receipts) and how to (re)configure the signing material in a deployment.

> **Why this doc exists:** the Wallet feature shipped with `APPLE_PASS_TYPE_ID_*`
> env vars pointing at identifiers that were **never registered in Apple's
> portal**, and the signing certificate/key were **never created or deployed**.
> Result: every authenticated pass request returned **503 "Apple Wallet … not
> configured for this deployment"** — silently, because the 503 only fires after
> auth/RSVP checks pass. This was pure tribal knowledge. Configured 2026-06-24.

## TL;DR — what a working deployment needs

The pass routes (`apps/web/src/app/api/wallet/{member,event,receipt}/...`) read
these at **runtime** from `process.env`. All must be present in the environment
that serves the route (e.g. Vercel **Production**):

| Var | Value / source |
|-----|----------------|
| `APPLE_PASS_SIGNER_CERT_PEM` | Pass Type ID certificate, PEM (from Apple, via CSR) |
| `APPLE_PASS_SIGNER_KEY_PEM` | Private key for that cert, PEM (generated locally) |
| `APPLE_WWDR_CERT_PEM` | Apple WWDR **G4** intermediate cert, PEM (public download) |
| `APPLE_PASS_SIGNER_KEY_PASSPHRASE` | Only if the key is encrypted. **Currently unset** (key is unencrypted). |
| `APPLE_PASS_TYPE_ID_MEMBER` | `pass.com.myteamnetwork.teammeet` |
| `APPLE_PASS_TYPE_ID_EVENT` | `pass.com.myteamnetwork.teammeet` |
| `APPLE_PASS_TYPE_ID_RECEIPT` | `pass.com.myteamnetwork.teammeet` |
| `APPLE_PASS_TEAM_ID` | `5GWLTFG43T` (Teamra LLC) |

If any of the cert/key/WWDR vars are missing, `readXPassEnv()` returns `null` →
the route returns **503**. Env changes require a **redeploy** to take effect.

## Design decision: ONE pass type ID for all three pass kinds

An Apple **Pass Type ID certificate is bound to a single pass type identifier**,
and the routes share **one** signer cert (`APPLE_PASS_SIGNER_CERT_PEM`). So all
three pass kinds use the **same** identifier — `pass.com.myteamnetwork.teammeet` —
and all three `APPLE_PASS_TYPE_ID_*` vars point at it. The pass *content* still
differs per kind; only the signing identity is shared.

> If you ever need three **distinct** identifiers, you must create three certs
> AND change the code so each route reads its own signer env
> (e.g. `APPLE_PASS_SIGNER_CERT_PEM_EVENT`). Not worth it unless there's a real
> reason — keep the single-identifier setup.

## First-time setup (or full rotation)

### 1. Generate the signing key + CSR (local, no Apple login needed)

```bash
WORK="$HOME/teammeet-pass-certs"; mkdir -p "$WORK"; cd "$WORK"
openssl genrsa -out pass_signer_key.pem 2048
openssl req -new -key pass_signer_key.pem -out pass_signer.csr \
  -subj "/UID=pass.com.myteamnetwork.teammeet/CN=TeamNetwork Pass Type ID/O=Teamra LLC/C=US"
```

### 2. Create the Pass Type ID + certificate (Apple Developer portal — interactive)

1. developer.apple.com → **Certificates, Identifiers & Profiles** → **Identifiers**.
2. Top-right filter dropdown → switch from **App IDs** to **Pass Type IDs**.
   (Pass Type IDs are a *separate* category from App IDs — this trips people up.)
3. **+** → **Pass Type IDs** → register identifier `pass.com.myteamnetwork.teammeet`.
4. Open it → **Create Certificate** (or Certificates → **+** → **Pass Type ID
   Certificate** → select the identifier).
5. Upload **`pass_signer.csr`** → Continue → **Download** the issued cert
   (`pass.cer`) into `~/teammeet-pass-certs/`.

### 3. Convert + verify

```bash
cd "$HOME/teammeet-pass-certs"
# Pass Type ID cert: DER -> PEM
openssl x509 -inform der -in pass.cer -out signerCert.pem
# Apple WWDR G4 intermediate (public): download + DER -> PEM
curl -s -o AppleWWDRCAG4.cer https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem

# Verify cert <-> key are a pair (md5 of both modulus must match):
diff <(openssl x509 -noout -modulus -in signerCert.pem) \
     <(openssl rsa  -noout -modulus -in pass_signer_key.pem) && echo "cert/key MATCH"
# Verify the cert chains to the WWDR you'll ship:
openssl verify -partial_chain -CAfile wwdr.pem signerCert.pem   # -> signerCert.pem: OK
```

### 4. Upload to Vercel Production + redeploy

```bash
cd <repo root>   # must be the Vercel-linked dir
vercel env add APPLE_PASS_SIGNER_CERT_PEM production < "$HOME/teammeet-pass-certs/signerCert.pem"
vercel env add APPLE_PASS_SIGNER_KEY_PEM  production < "$HOME/teammeet-pass-certs/pass_signer_key.pem"
vercel env add APPLE_WWDR_CERT_PEM        production < "$HOME/teammeet-pass-certs/wwdr.pem"

# Point all three type-ID vars at the single identifier (rm any stale values first):
for v in APPLE_PASS_TYPE_ID_MEMBER APPLE_PASS_TYPE_ID_EVENT APPLE_PASS_TYPE_ID_RECEIPT; do
  vercel env rm "$v" production -y 2>/dev/null
  printf 'pass.com.myteamnetwork.teammeet' | vercel env add "$v" production
done

# Env changes need a fresh deploy:
vercel redeploy <latest-prod-deployment-url>     # or push to main / click Redeploy
```

### 5. Back up the private key

`pass_signer_key.pem` is the only local copy of the signing key (also in Vercel's
encrypted store). Stash it in a password manager, then delete the local folder.
If lost, just generate a new key+CSR and a new cert (the old one keeps working
until you replace it).

## How a request reaches a 200 (gate order)

Event ticket route (`route.ts`), in order — each failed gate is a distinct status:

1. Valid UUID event id — else **400**
2. Rate limit — else **429**
3. Authenticated via **Bearer** (mobile) or cookie (web) — else **401**
   - The mobile client sends `Authorization: Bearer <token>` and no cookies;
     the route uses `createAuthenticatedApiClient(req)` so both work. (A plain
     unauthenticated `curl` always returns 401 — it can't confirm cert config.)
4. Event exists — else **404**
5. Org has slug/name — else **500**
6. Requester has an RSVP that isn't "not attending" — else **403** "RSVP required"
7. Pass signing env present (this doc) — else **503**
8. Pass generates → **200** + `application/vnd.apple.pkpass`

To test end-to-end you need a signed-in user who has **RSVP'd** to the event.

## Maintenance

- **Expiry:** the Pass Type ID cert is valid ~1 year (the 2026-06-24 cert expires
  **2027-07-24**). Before then, repeat steps 1–4 with a fresh cert and redeploy.
  Passes already in users' wallets keep working; only new issuance needs a live cert.
- **WWDR:** Apple rotates the WWDR intermediate occasionally. If signing starts
  failing chain validation, re-download the current WWDR cert (step 3) and
  re-upload `APPLE_WWDR_CERT_PEM`.
- The mobile side never signs passes — it only downloads the `.pkpass` and opens
  it via `Linking.openURL` (`apps/mobile/src/lib/add-to-wallet.ts`). **None of
  this goes in EAS credentials.**
