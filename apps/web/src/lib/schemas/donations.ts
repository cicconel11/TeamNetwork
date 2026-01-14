import { z } from "zod";
import { safeString, optionalSafeString } from "./common";

// Donation form
export const donationSchema = z
  .object({
    amount: z
      .union([z.string(), z.number()])
      .transform((val) => {
        if (typeof val === "string") {
          const num = parseFloat(val);
          return isNaN(num) ? 0 : num;
        }
        return val;
      })
      .refine((val) => val >= 1, { message: "Minimum donation is $1" }),
    designation: optionalSafeString(200),
    customDesignation: optionalSafeString(200),
    message: optionalSafeString(1000),
    isAnonymous: z.boolean().default(false),
  })
  .refine(
    (data) => {
      // If designation is "other", customDesignation is required
      if (data.designation === "other" && !data.customDesignation) {
        return false;
      }
      return true;
    },
    {
      message: "Please specify a designation",
      path: ["customDesignation"],
    }
  );
export type DonationForm = z.infer<typeof donationSchema>;

// New donation page form (admin creating donation record)
export const newDonationRecordSchema = z.object({
  donor_name: safeString(200),
  donor_email: z.string().email().optional().or(z.literal("")),
  amount: z
    .union([z.string(), z.number()])
    .transform((val) => {
      if (typeof val === "string") {
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
      }
      return val;
    })
    .refine((val) => val > 0, { message: "Amount must be greater than 0" }),
  designation: optionalSafeString(200),
  notes: optionalSafeString(1000),
  donation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Invalid date format" }),
});
export type NewDonationRecordForm = z.infer<typeof newDonationRecordSchema>;

export const editDonationRecordSchema = newDonationRecordSchema;
export type EditDonationRecordForm = z.infer<typeof editDonationRecordSchema>;
