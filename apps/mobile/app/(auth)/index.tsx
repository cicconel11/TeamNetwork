import { useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const { width } = Dimensions.get("window");

// Feature data
const FEATURES = [
  {
    icon: "👥",
    title: "Member Directory",
    description: "Manage active members and alumni with detailed profiles.",
  },
  {
    icon: "📅",
    title: "Events & Calendar",
    description: "Schedule practices, games, and social events in one place.",
  },
  {
    icon: "💰",
    title: "Donations",
    description: "Accept donations directly with Stripe Connect integration.",
  },
  {
    icon: "🏆",
    title: "Records & Awards",
    description: "Track achievements, records, and team history.",
  },
  {
    icon: "📢",
    title: "Announcements",
    description: "Keep everyone informed with targeted announcements.",
  },
  {
    icon: "📄",
    title: "Forms & Documents",
    description: "Collect information and share important documents.",
  },
];

// How it works steps
const STEPS = [
  {
    number: "01",
    title: "Create your org",
    description: "Sign up and customize your team's profile and settings.",
  },
  {
    number: "02",
    title: "Invite members",
    description: "Share your unique invite code or send email invitations.",
  },
  {
    number: "03",
    title: "Build your legacy",
    description: "Track events, manage donations, and connect generations.",
  },
];

// FAQ items
const FAQ_ITEMS = [
  {
    question: "Who is TeamNetwork for?",
    answer:
      "Sports teams, Greek life organizations, clubs, volunteer groups, alumni associations, and any organization that wants to stay connected.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "Yes! You can explore the platform with a 14-day free trial. No credit card required to get started.",
  },
  {
    question: "Can I invite alumni?",
    answer:
      "Absolutely. Our alumni network feature lets you maintain connections with past members and track their careers.",
  },
];

export default function LandingScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>TN</Text>
            </View>
            <Text style={styles.brandName}>
              Team<Text style={styles.brandAccent}>Network</Text>
            </Text>
          </View>
        </View>

        {/* Hero Section */}
        <View style={styles.hero}>
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>Built for teams that go the distance</Text>
          </View>

          <Text style={styles.heroTitle}>
            Your Team's{"\n"}
            <Text style={styles.heroTitleAccent}>Hub for Everything</Text>
          </Text>

          <Text style={styles.heroDescription}>
            Member directories, events, donations, and records — all in one place.
            Built for sports teams, clubs, and organizations of all kinds.
          </Text>

          <View style={styles.ctaContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push("/(auth)/signup")}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Get Started</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push("/(auth)/login")}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.inviteLink}
            onPress={() => router.push("/(auth)/login")}
          >
            <Text style={styles.inviteLinkLabel}>Have an invite code?</Text>
            <Text style={styles.inviteLinkText}>Join an Organization →</Text>
          </TouchableOpacity>
        </View>

        {/* Mock Organization Card */}
        <View style={styles.mockCardContainer}>
          <View style={styles.mockCard}>
            <View style={styles.mockCardHeader}>
              <View style={styles.mockOrgAvatar}>
                <Text style={styles.mockOrgAvatarText}>SR</Text>
              </View>
              <View style={styles.mockOrgInfo}>
                <Text style={styles.mockOrgName}>South Rock Ridge HS</Text>
                <Text style={styles.mockOrgLocation}>Central Pennsylvania</Text>
              </View>
            </View>

            <View style={styles.mockStats}>
              <View style={styles.mockStat}>
                <Text style={styles.mockStatValue}>127</Text>
                <Text style={styles.mockStatLabel}>Members</Text>
              </View>
              <View style={styles.mockStatDivider} />
              <View style={styles.mockStat}>
                <Text style={styles.mockStatValue}>24</Text>
                <Text style={styles.mockStatLabel}>Events</Text>
              </View>
              <View style={styles.mockStatDivider} />
              <View style={styles.mockStat}>
                <Text style={styles.mockStatValue}>$8.2k</Text>
                <Text style={styles.mockStatLabel}>Donations</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Organization Types */}
        <View style={styles.orgTypes}>
          <Text style={styles.orgTypesText}>
            Sports Teams • Greek Life • Clubs • Alumni Groups
          </Text>
        </View>

        {/* Features Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FEATURES</Text>
          <Text style={styles.sectionTitle}>
            Everything Your{"\n"}
            <Text style={styles.sectionTitleAccent}>Team Needs</Text>
          </Text>

          <View style={styles.featuresGrid}>
            {FEATURES.map((feature) => (
              <View key={feature.title} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  <Text style={styles.featureIconText}>{feature.icon}</Text>
                </View>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* How It Works */}
        <View style={[styles.section, styles.sectionAlt]}>
          <Text style={styles.sectionTitle}>
            Get Started in <Text style={styles.sectionTitleAccent}>3 Steps</Text>
          </Text>

          <View style={styles.stepsContainer}>
            {STEPS.map((step, index) => (
              <View key={step.number} style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{step.number}</Text>
                </View>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDescription}>{step.description}</Text>
                {index < STEPS.length - 1 && <View style={styles.stepConnector} />}
              </View>
            ))}
          </View>
        </View>

        {/* FAQ Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Questions? <Text style={styles.sectionTitleAccent}>Answers.</Text>
          </Text>

          <View style={styles.faqContainer}>
            {FAQ_ITEMS.map((item) => (
              <View key={item.question} style={styles.faqItem}>
                <Text style={styles.faqQuestion}>{item.question}</Text>
                <Text style={styles.faqAnswer}>{item.answer}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Final CTA */}
        <View style={styles.finalCta}>
          <View style={styles.finalCtaBadge}>
            <Text style={styles.finalCtaBadgeText}>READY TO START?</Text>
          </View>

          <Text style={styles.finalCtaTitle}>
            Build Your Team's{"\n"}
            <Text style={styles.finalCtaTitleAccent}>Legacy Today</Text>
          </Text>

          <Text style={styles.finalCtaDescription}>
            Join today to create new opportunities for your organization and members.
          </Text>

          <View style={styles.finalCtaButtons}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push("/(auth)/signup")}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Create Your Organization</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push("/(auth)/login")}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerLogo}>
            <View style={styles.logoBoxSmall}>
              <Text style={styles.logoTextSmall}>TN</Text>
            </View>
            <Text style={styles.footerBrand}>TeamNetwork</Text>
          </View>
          <Text style={styles.footerCopyright}>© 2026 TeamNetwork</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Colors matching web landing page
const colors = {
  navy: "#0f172a",
  navyLight: "#1e293b",
  cream: "#fef3c7",
  creamMuted: "rgba(254, 243, 199, 0.7)",
  creamFaint: "rgba(254, 243, 199, 0.1)",
  green: "#10b981",
  greenDark: "#059669",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.navy,
  },
  scrollView: {
    flex: 1,
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.creamFaint,
  },
  logoContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.greenDark,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 14,
  },
  brandName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "white",
  },
  brandAccent: {
    color: colors.cream,
  },

  // Hero
  hero: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 32,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.creamFaint,
    borderWidth: 1,
    borderColor: "rgba(254, 243, 199, 0.2)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 24,
    gap: 8,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.creamMuted,
  },
  badgeText: {
    color: colors.creamMuted,
    fontSize: 13,
    fontWeight: "500",
  },
  heroTitle: {
    fontSize: 40,
    fontWeight: "bold",
    color: "white",
    lineHeight: 46,
    marginBottom: 16,
  },
  heroTitleAccent: {
    color: colors.cream,
  },
  heroDescription: {
    fontSize: 17,
    color: colors.creamMuted,
    lineHeight: 26,
    marginBottom: 32,
  },
  ctaContainer: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: colors.greenDark,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: colors.creamFaint,
    borderWidth: 1,
    borderColor: "rgba(254, 243, 199, 0.2)",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: "600",
  },
  inviteLink: {
    marginTop: 24,
  },
  inviteLinkLabel: {
    color: "rgba(254, 243, 199, 0.5)",
    fontSize: 13,
    marginBottom: 4,
  },
  inviteLinkText: {
    color: colors.creamMuted,
    fontSize: 15,
    fontWeight: "500",
  },

  // Mock Card
  mockCardContainer: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  mockCard: {
    backgroundColor: "rgba(30, 41, 59, 0.8)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.creamFaint,
    overflow: "hidden",
  },
  mockCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(254, 243, 199, 0.05)",
    borderBottomWidth: 1,
    borderBottomColor: colors.creamFaint,
    gap: 12,
  },
  mockOrgAvatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "rgba(254, 243, 199, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(254, 243, 199, 0.2)",
  },
  mockOrgAvatarText: {
    color: colors.cream,
    fontWeight: "bold",
    fontSize: 16,
  },
  mockOrgInfo: {
    flex: 1,
  },
  mockOrgName: {
    color: colors.cream,
    fontWeight: "bold",
    fontSize: 16,
  },
  mockOrgLocation: {
    color: "rgba(254, 243, 199, 0.5)",
    fontSize: 13,
    marginTop: 2,
  },
  mockStats: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.creamFaint,
  },
  mockStat: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  mockStatValue: {
    color: colors.cream,
    fontSize: 22,
    fontWeight: "bold",
  },
  mockStatLabel: {
    color: "rgba(254, 243, 199, 0.5)",
    fontSize: 11,
    marginTop: 2,
  },
  mockStatDivider: {
    width: 1,
    backgroundColor: colors.creamFaint,
  },

  // Organization Types
  orgTypes: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.creamFaint,
    backgroundColor: "rgba(30, 41, 59, 0.5)",
  },
  orgTypesText: {
    color: "rgba(254, 243, 199, 0.4)",
    fontSize: 12,
    textAlign: "center",
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  // Sections
  section: {
    paddingHorizontal: 20,
    paddingVertical: 48,
  },
  sectionAlt: {
    backgroundColor: "rgba(30, 41, 59, 0.3)",
  },
  sectionLabel: {
    color: "rgba(254, 243, 199, 0.6)",
    fontSize: 11,
    letterSpacing: 3,
    textAlign: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "white",
    textAlign: "center",
    lineHeight: 40,
    marginBottom: 32,
  },
  sectionTitleAccent: {
    color: colors.cream,
  },

  // Features
  featuresGrid: {
    gap: 16,
  },
  featureCard: {
    backgroundColor: "rgba(30, 41, 59, 0.5)",
    borderRadius: 16,
    padding: 20,
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.creamFaint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  featureIconText: {
    fontSize: 24,
  },
  featureTitle: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 6,
  },
  featureDescription: {
    color: "rgba(254, 243, 199, 0.5)",
    fontSize: 14,
    lineHeight: 20,
  },

  // Steps
  stepsContainer: {
    gap: 24,
  },
  step: {
    alignItems: "center",
    position: "relative",
  },
  stepNumber: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.navy,
    borderWidth: 2,
    borderColor: "rgba(254, 243, 199, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  stepNumberText: {
    color: colors.cream,
    fontSize: 24,
    fontWeight: "bold",
  },
  stepTitle: {
    color: colors.cream,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  stepDescription: {
    color: "rgba(254, 243, 199, 0.5)",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  stepConnector: {
    width: 2,
    height: 24,
    backgroundColor: "rgba(254, 243, 199, 0.2)",
    position: "absolute",
    bottom: -24,
  },

  // FAQ
  faqContainer: {
    gap: 12,
  },
  faqItem: {
    backgroundColor: "rgba(30, 41, 59, 0.5)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.creamFaint,
    padding: 20,
  },
  faqQuestion: {
    color: colors.cream,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
  },
  faqAnswer: {
    color: "rgba(254, 243, 199, 0.6)",
    fontSize: 14,
    lineHeight: 22,
  },

  // Final CTA
  finalCta: {
    paddingHorizontal: 20,
    paddingVertical: 56,
    alignItems: "center",
  },
  finalCtaBadge: {
    backgroundColor: colors.greenDark,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    marginBottom: 24,
  },
  finalCtaBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  finalCtaTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "white",
    textAlign: "center",
    lineHeight: 40,
    marginBottom: 16,
  },
  finalCtaTitleAccent: {
    color: colors.green,
  },
  finalCtaDescription: {
    color: "rgba(254, 243, 199, 0.6)",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
    maxWidth: 320,
  },
  finalCtaButtons: {
    width: "100%",
    gap: 12,
  },

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    borderTopWidth: 1,
    borderTopColor: colors.creamFaint,
    alignItems: "center",
    gap: 16,
  },
  footerLogo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoBoxSmall: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.greenDark,
    alignItems: "center",
    justifyContent: "center",
  },
  logoTextSmall: {
    color: "white",
    fontWeight: "bold",
    fontSize: 11,
  },
  footerBrand: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  footerCopyright: {
    color: "rgba(254, 243, 199, 0.3)",
    fontSize: 13,
  },
});
