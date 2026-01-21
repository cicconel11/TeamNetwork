import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { useOrgTheme } from "@/hooks/useOrgTheme";
import type { ThemeColors } from "@/lib/theme";

type TermsSection = {
  id: string;
  number: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

const termsSections: TermsSection[] = [
  {
    id: "acceptance",
    number: "1",
    title: "Acceptance of Terms",
    paragraphs: [
      "By accessing or using TeamNetwork (\"the Service\"), operated by MAC Connect LLC, you agree to comply with and be bound by these Terms of Service (\"Terms\"). If you do not agree, you may not use the Service.",
    ],
  },
  {
    id: "eligibility",
    number: "2",
    title: "Eligibility",
    paragraphs: [
      "You must be at least 16 years old to use the Service. By using the Service, you represent and warrant that you meet this age requirement.",
    ],
  },
  {
    id: "registration",
    number: "3",
    title: "Account Registration",
    paragraphs: [
      "Users must provide accurate, complete, and current information.",
    ],
    bullets: [
      "You are responsible for maintaining the confidentiality of your account credentials.",
      "You are fully responsible for all activity occurring under your account.",
    ],
  },
  {
    id: "conduct",
    number: "4",
    title: "User Conduct",
    paragraphs: [
      "You agree not to:",
      "Violation of these rules may result in immediate suspension or termination of your account.",
    ],
    bullets: [
      "Violate any applicable laws or regulations.",
      "Upload or transmit content that is illegal, harmful, threatening, abusive, harassing, defamatory, obscene, infringing, or otherwise objectionable.",
      "Attempt to access accounts, systems, or data not authorized to you.",
      "Reverse engineer, copy, modify, or exploit any portion of the Service or its technology.",
    ],
  },
  {
    id: "ip",
    number: "5",
    title: "Intellectual Property & License",
    paragraphs: [
      "TeamNetwork and its licensors retain all rights, title, and interest in the Service, including software, content, designs, trademarks, and logos.",
      "Users may not copy, modify, distribute, create derivative works, or reverse engineer any part of the Service.",
      "By submitting content, you grant TeamNetwork a non-exclusive, worldwide, royalty-free license to display and use your content solely to provide the Service.",
      "TeamNetwork reserves the right to remove any content that violates intellectual property rights or these Terms.",
    ],
  },
  {
    id: "payments",
    number: "6",
    title: "Payments and Subscriptions",
    paragraphs: [
      "Certain features may require payment; all fees are non-refundable unless required by law.",
      "TeamNetwork may adjust fees with notice.",
      "Unauthorized use or sharing of paid content is strictly prohibited.",
    ],
  },
  {
    id: "donations",
    number: "7",
    title: "Donations and Mentorship",
    paragraphs: [
      "The Service may include options to donate to teams or programs, or participate in mentorship opportunities. Users understand that all donations are voluntary and may be subject to separate terms and conditions.",
      "TeamNetwork does not guarantee mentorship outcomes or engagement levels; participation is at the discretion of mentors and teams.",
    ],
  },
  {
    id: "termination",
    number: "8",
    title: "Termination",
    paragraphs: [
      "TeamNetwork may suspend or terminate accounts at any time for violations of these Terms.",
      "Upon termination, your access to content and the Service is revoked, and no refunds will be provided.",
    ],
  },
  {
    id: "disclaimers",
    number: "9",
    title: "Disclaimers",
    paragraphs: [
      "The Service is provided \"as is\" and \"as available\" without warranties of any kind.",
      "TeamNetwork disclaims all warranties, including merchantability, fitness for a particular purpose, and non-infringement.",
      "Use of the Service is at your own risk.",
    ],
  },
  {
    id: "liability",
    number: "10",
    title: "Limitation of Liability",
    paragraphs: [
      "To the fullest extent permitted by law, TeamNetwork shall not be liable for:",
    ],
    bullets: [
      "Any direct, indirect, incidental, special, consequential, or punitive damages.",
      "Loss of profits, data, goodwill, or other intangible losses.",
      "Any claim arising from user content or user conduct.",
    ],
  },
  {
    id: "indemnification",
    number: "11",
    title: "Indemnification",
    paragraphs: [
      "You agree to indemnify, defend, and hold harmless TeamNetwork, MAC Connect LLC, and their affiliates from any claims, damages, or expenses arising from:",
    ],
    bullets: [
      "Your use of the Service.",
      "Your violation of these Terms.",
      "Your violation of intellectual property or other rights.",
    ],
  },
  {
    id: "arbitration",
    number: "12",
    title: "Dispute Resolution and Arbitration",
    paragraphs: [],
    bullets: [
      "Binding Arbitration: Any dispute, claim, or controversy arising out of or relating to these Terms or your use of the Service shall be resolved exclusively through final and binding arbitration under the rules of the American Arbitration Association (AAA).",
      "Waiver of Class Actions: You agree that any arbitration shall be conducted only on an individual basis and not as a class, collective, or representative action, and you expressly waive the right to participate in any class, collective, or representative proceeding.",
      "No Jury Trial: You waive any right to a jury trial for any claims related to these Terms or the Service.",
      "Location and Costs: The arbitration will take place in New York, NY, unless we agree otherwise in writing. Each party will bear its own costs and fees, except as provided under the AAA rules.",
      "Enforceability: If any portion of this arbitration clause is found unenforceable, the remaining provisions shall remain in full force and effect.",
    ],
  },
  {
    id: "changes",
    number: "13",
    title: "Changes to Terms",
    paragraphs: [
      "TeamNetwork may modify these Terms at any time. Changes will be effective when posted. Continued use of the Service constitutes acceptance of the updated Terms.",
    ],
  },
  {
    id: "governing-law",
    number: "14",
    title: "Governing Law",
    paragraphs: [
      "These Terms are governed by the laws of the State of New York, without regard to conflict of law principles.",
    ],
  },
  {
    id: "contact",
    number: "15",
    title: "Contact Information",
    paragraphs: [
      "Email: support@myteamnetwork.com",
    ],
  },
];

export default function TermsScreen() {
  const { colors } = useOrgTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: "Terms of Service" }} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Terms of Service</Text>
          <Text style={styles.lastUpdated}>Last Updated: December 8, 2025</Text>
        </View>

        {/* Sections */}
        {termsSections.map((section) => (
          <View key={section.id} style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.numberBadge}>
                <Text style={styles.numberBadgeText}>{section.number}</Text>
              </View>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            <View style={styles.sectionContent}>
              {section.paragraphs.map((paragraph, index) => (
                <Text key={index} style={styles.paragraph}>
                  {paragraph}
                </Text>
              ))}
              {section.bullets && (
                <View style={styles.bulletList}>
                  {section.bullets.map((bullet, index) => (
                    <View key={index} style={styles.bulletItem}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: 16,
      paddingBottom: 40,
    },
    header: {
      marginBottom: 24,
    },
    title: {
      fontSize: 28,
      fontWeight: "700",
      color: colors.foreground,
      marginBottom: 8,
    },
    lastUpdated: {
      fontSize: 14,
      color: colors.mutedForeground,
    },
    sectionCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderCurve: "continuous",
      padding: 16,
      marginBottom: 12,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: 12,
      gap: 12,
    },
    numberBadge: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    numberBadgeText: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.primaryForeground,
    },
    sectionTitle: {
      flex: 1,
      fontSize: 18,
      fontWeight: "600",
      color: colors.foreground,
      lineHeight: 24,
      paddingTop: 4,
    },
    sectionContent: {
      gap: 12,
    },
    paragraph: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.mutedForeground,
    },
    bulletList: {
      gap: 8,
    },
    bulletItem: {
      flexDirection: "row",
      gap: 8,
    },
    bulletDot: {
      fontSize: 15,
      color: colors.primary,
      lineHeight: 22,
      marginTop: 1,
    },
    bulletText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 22,
      color: colors.mutedForeground,
    },
  });
