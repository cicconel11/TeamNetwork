#!/usr/bin/env npx tsx
/**
 * Diagnostic script to test the Bright Data LinkedIn API directly.
 *
 * Usage:
 *   BRIGHT_DATA_API_KEY=your-key npx tsx scripts/test-bright-data.ts https://linkedin.com/in/username
 *
 * Or if BRIGHT_DATA_API_KEY is already in .env.local:
 *   npx tsx -r dotenv/config scripts/test-bright-data.ts https://linkedin.com/in/username
 */

import { fetchBrightDataProfile, mapBrightDataToFields } from "../src/lib/linkedin/bright-data";

async function main() {
  const linkedinUrl = process.argv[2];
  if (!linkedinUrl) {
    console.error("Usage: npx tsx scripts/test-bright-data.ts <linkedin-url>");
    console.error("Example: npx tsx scripts/test-bright-data.ts https://linkedin.com/in/satyanadella");
    process.exit(1);
  }

  const apiKey = process.env.BRIGHT_DATA_API_KEY;
  if (!apiKey) {
    console.error("Error: BRIGHT_DATA_API_KEY environment variable is not set.");
    console.error("Set it directly or load from .env.local:");
    console.error("  BRIGHT_DATA_API_KEY=your-key npx tsx scripts/test-bright-data.ts <url>");
    process.exit(1);
  }

  console.log("=== Bright Data LinkedIn API Diagnostic ===\n");
  console.log(`LinkedIn URL: ${linkedinUrl}`);
  console.log(`API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}\n`);

  console.log("--- Fetching profile from Bright Data API ---\n");
  const result = await fetchBrightDataProfile(linkedinUrl);

  if (!result.ok) {
    console.error("FETCH FAILED:");
    console.error(`  Kind: ${result.kind}`);
    console.error(`  Error: ${result.error}`);
    if (result.upstreamStatus) {
      console.error(`  HTTP Status: ${result.upstreamStatus}`);
    }
    process.exit(1);
  }

  const profile = result.profile;

  console.log("--- RAW PROFILE DATA ---\n");
  console.log(JSON.stringify(profile, null, 2));

  console.log("\n--- SUMMARY ---\n");
  console.log(`Name: ${profile.name ?? "(none)"}`);
  console.log(`Position/Headline: ${profile.position ?? "(none)"}`);
  console.log(`About/Bio: ${profile.about ? profile.about.substring(0, 200) + (profile.about.length > 200 ? "..." : "") : "(none)"}`);
  console.log(`City: ${profile.city ?? "(none)"}`);
  console.log(`Current Company: ${profile.current_company ?? "(none)"}`);
  console.log(`Current Company Name: ${profile.current_company_name ?? "(none)"}`);
  console.log(`Educations Details: ${profile.educations_details ?? "(none)"}`);
  console.log(`Avatar: ${profile.avatar ?? "(none)"}`);

  console.log(`\n--- EXPERIENCE (${profile.experience.length} entries) ---\n`);
  if (profile.experience.length === 0) {
    console.log("  (none returned — profile may have experience section hidden)");
  }
  for (const [i, exp] of profile.experience.entries()) {
    console.log(`  [${i}] ${exp.title ?? "?"} at ${exp.company ?? "?"}`);
    console.log(`      Location: ${exp.location ?? "(none)"}`);
    console.log(`      Dates: ${exp.start_date ?? "?"} – ${exp.end_date ?? "Present"}`);
    console.log(`      Description: ${exp.description_html ? exp.description_html.substring(0, 150) + "..." : "(none)"}`);
    console.log(`      Company Logo: ${exp.company_logo_url ?? "(none)"}`);
    console.log();
  }

  console.log(`--- EDUCATION (${profile.education.length} entries) ---\n`);
  if (profile.education.length === 0) {
    console.log("  (none returned — profile may have education section hidden)");
  }
  for (const [i, edu] of profile.education.entries()) {
    console.log(`  [${i}] ${edu.title ?? "?"} (school name from 'title' field)`);
    console.log(`      Degree: ${edu.degree ?? "(none)"}`);
    console.log(`      Field of Study: ${edu.field_of_study ?? "(none)"}`);
    console.log(`      Years: ${edu.start_year ?? "?"} – ${edu.end_year ?? "?"}`);
    console.log(`      Description: ${edu.description ?? "(none)"}`);
    console.log(`      Logo: ${edu.institute_logo_url ?? "(none)"}`);
    console.log();
  }

  console.log("--- MAPPED FIELDS (what gets stored in DB flat columns) ---\n");
  const fields = mapBrightDataToFields(profile);
  console.log(`  job_title: ${fields.job_title ?? "(null)"}`);
  console.log(`  current_company: ${fields.current_company ?? "(null)"}`);
  console.log(`  current_city: ${fields.current_city ?? "(null)"}`);
  console.log(`  school: ${fields.school ?? "(null)"}`);
  console.log(`  major: ${fields.major ?? "(null)"}`);
  console.log(`  position_title: ${fields.position_title ?? "(null)"}`);
  console.log(`  industry: ${fields.industry ?? "(null)"}`);

  console.log("\n--- ENRICHMENT JSON (what gets stored in user_linkedin_connections) ---\n");
  console.log("The full profile object above is stored as linkedin_data.enrichment");
  console.log(`This includes ${profile.experience.length} experience entries and ${profile.education.length} education entries`);
  console.log("The member view page reads experience[] and education[] from this JSON to display all jobs/schools");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
