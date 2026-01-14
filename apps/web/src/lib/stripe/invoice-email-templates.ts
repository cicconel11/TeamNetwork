interface InvoiceEmailContext {
  entityName: string;
}

interface EmailTemplate {
  subject: string;
  body: string;
}

export function buildRenewalReminderEmail(
  renewalDate: string,
  amountFormatted: string,
  ctx: InvoiceEmailContext
): EmailTemplate {
  return {
    subject: `Subscription Renewal Reminder - ${ctx.entityName}`,
    body: `Your subscription for ${ctx.entityName} renews on ${renewalDate} for ${amountFormatted}.

If you need to update your payment method or make changes to your plan, please check your billing settings before the renewal date.

No action is needed if everything looks correct.`,
  };
}

export function buildPaymentActionRequiredEmail(
  hostedInvoiceUrl: string,
  ctx: InvoiceEmailContext
): EmailTemplate {
  return {
    subject: `[Action Required] Payment Authentication Needed - ${ctx.entityName}`,
    body: `Your recent payment for ${ctx.entityName} requires additional authentication to complete.

Please complete the payment verification here:
${hostedInvoiceUrl}

This is typically required by your bank for security purposes (3D Secure). Your subscription may be interrupted if the payment is not completed.`,
  };
}

export function buildFinalizationFailedEmail(
  errorMessage: string | null,
  ctx: InvoiceEmailContext
): EmailTemplate {
  const errorDetail = errorMessage
    ? `\n\nError details: ${errorMessage}`
    : "";

  return {
    subject: `[Action Required] Billing Issue - ${ctx.entityName}`,
    body: `An invoice for ${ctx.entityName} could not be processed.${errorDetail}

Please check your billing settings to ensure your payment information is up to date. If this issue persists, contact support for assistance.`,
  };
}
