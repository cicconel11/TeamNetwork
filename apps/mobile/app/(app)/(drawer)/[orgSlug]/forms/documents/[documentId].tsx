import { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Download, Upload, Check, FileText } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import * as FileSystem from "expo-file-system";
import { supabase } from "@/lib/supabase";
import { useOrg } from "@/contexts/OrgContext";
import type { FormDocument, FormDocumentSubmission } from "@teammeet/types";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";

const DOC_COLORS = {
  background: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  primaryCTA: "#059669",
  primaryCTAText: "#ffffff",
  error: "#ef4444",
  errorBackground: "#fef2f2",
  infoBadge: "#dbeafe",
  infoText: "#1e40af",
  successBadge: "#d1fae5",
  successText: "#065f46",
  pdfIcon: "#ef4444",
};

export default function DocumentFormDetailScreen() {
  const { documentId, orgSlug: paramOrgSlug } = useLocalSearchParams<{ documentId: string; orgSlug: string }>();
  const { orgSlug: contextOrgSlug } = useOrg();
  const orgSlug = paramOrgSlug || contextOrgSlug;
  const router = useRouter();
  const styles = useMemo(() => createStyles(), []);

  const [document, setDocument] = useState<FormDocument | null>(null);
  const [existingSubmission, setExistingSubmission] = useState<FormDocumentSubmission | null>(null);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch document and existing submission
  useEffect(() => {
    let isMounted = true;

    async function loadDocument() {
      if (!documentId) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();

        // Fetch document
        const { data: docData, error: docError } = await supabase
          .from("form_documents")
          .select("*")
          .eq("id", documentId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .single();

        if (docError || !docData) {
          if (isMounted) {
            setError("Document not found");
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          setDocument(docData as FormDocument);
        }

        // Check for existing submission
        if (user) {
          const { data: submission } = await supabase
            .from("form_document_submissions")
            .select("*")
            .eq("document_id", documentId)
            .eq("user_id", user.id)
            .order("submitted_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (submission && isMounted) {
            setExistingSubmission(submission as FormDocumentSubmission);
          }
        }

        if (isMounted) {
          setLoading(false);
        }
      } catch (e) {
        if (isMounted) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }

    loadDocument();
    return () => { isMounted = false; };
  }, [documentId]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(app)/${orgSlug}/forms`);
    }
  }, [router, orgSlug]);

  const handleDownloadTemplate = async () => {
    if (!document) return;

    setDownloading(true);
    setError(null);

    try {
      const { data, error: signedUrlError } = await supabase.storage
        .from("form-documents")
        .createSignedUrl(document.file_path, 60 * 5); // 5 minutes

      if (signedUrlError || !data?.signedUrl) {
        throw new Error("Failed to generate download link");
      }

      // Open in browser for download
      await Linking.openURL(data.signedUrl);
    } catch (e) {
      setError((e as Error).message);
      Alert.alert("Download Failed", (e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const handleSelectFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/png", "image/jpeg", "image/jpg"],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];

      // Validate file size (20MB max)
      if (file.size && file.size > 20 * 1024 * 1024) {
        setError("File size must be under 20MB");
        return;
      }

      setSelectedFile(file);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile || !document) return;

    setUploading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError("You must be logged in");
        setUploading(false);
        return;
      }

      // Read file as base64
      const fileUri = selectedFile.uri;
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Convert base64 to Uint8Array
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Upload file to storage
      const timestamp = Date.now();
      const fileName = selectedFile.name || "submission";
      const filePath = `${document.organization_id}/submissions/${user.id}/${timestamp}_${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("form-documents")
        .upload(filePath, bytes, {
          contentType: selectedFile.mimeType || "application/octet-stream",
        });

      if (uploadError) throw uploadError;

      // Create submission record
      const { error: dbError } = await supabase
        .from("form_document_submissions")
        .insert({
          document_id: documentId,
          organization_id: document.organization_id,
          user_id: user.id,
          file_name: fileName,
          file_path: filePath,
          file_size: selectedFile.size || null,
          mime_type: selectedFile.mimeType || null,
        });

      if (dbError) throw dbError;

      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={DOC_COLORS.primaryCTA} />
      </View>
    );
  }

  if (!document) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Document Not Found</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error || "Document not found"}</Text>
          </View>
        </View>
      </View>
    );
  }

  // Success state
  if (success) {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle} numberOfLines={1}>{document.title}</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
        <View style={styles.contentSheet}>
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <Check size={48} color={DOC_COLORS.primaryCTA} />
            </View>
            <Text style={styles.successTitle}>Document Submitted!</Text>
            <Text style={styles.successText}>Your completed form has been uploaded.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleBack}>
              <Text style={styles.primaryButtonText}>Back to Forms</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleBack} style={styles.backButton}>
              <ChevronLeft size={24} color={APP_CHROME.headerTitle} />
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>{document.title}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={styles.contentSheet}
        contentContainerStyle={styles.scrollContent}
      >
        {document.description && (
          <Text style={styles.description}>{document.description}</Text>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        )}

        {/* Step 1: Download */}
        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <Text style={styles.stepTitle}>Download the Form</Text>
          </View>
          <Text style={styles.stepDescription}>
            Download the form template, print it, and fill it out.
          </Text>
          <TouchableOpacity
            style={styles.downloadButton}
            onPress={handleDownloadTemplate}
            disabled={downloading}
          >
            {downloading ? (
              <ActivityIndicator size="small" color={DOC_COLORS.primaryText} />
            ) : (
              <>
                <Download size={18} color={DOC_COLORS.primaryText} />
                <Text style={styles.downloadButtonText}>
                  Download Form ({document.file_name})
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Step 2: Upload */}
        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <Text style={styles.stepTitle}>Upload Completed Form</Text>
          </View>
          <Text style={styles.stepDescription}>
            Scan or photograph your completed form and upload it here.
          </Text>

          {existingSubmission && (
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerText}>
                You submitted this form on {new Date(existingSubmission.submitted_at!).toLocaleDateString()}.
                You can submit a new version below.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.uploadArea}
            onPress={handleSelectFile}
          >
            {selectedFile ? (
              <View style={styles.selectedFileContainer}>
                <View style={styles.fileIconSuccess}>
                  <FileText size={24} color={DOC_COLORS.primaryCTA} />
                </View>
                <Text style={styles.selectedFileName} numberOfLines={1}>
                  {selectedFile.name}
                </Text>
                {selectedFile.size && (
                  <Text style={styles.selectedFileSize}>
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </Text>
                )}
              </View>
            ) : (
              <View style={styles.uploadPlaceholder}>
                <Upload size={32} color={DOC_COLORS.mutedText} />
                <Text style={styles.uploadPlaceholderText}>
                  Tap to select your completed form
                </Text>
                <Text style={styles.uploadPlaceholderHint}>
                  PDF or image, max 20MB
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!selectedFile || uploading) && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedFile || uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={DOC_COLORS.primaryCTAText} />
            ) : (
              <Text style={styles.primaryButtonText}>Submit Completed Form</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: APP_CHROME.gradientEnd,
    },
    headerGradient: {
      paddingBottom: spacing.xs,
    },
    headerSafeArea: {},
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
    },
    backButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: DOC_COLORS.background,
      borderTopLeftRadius: borderRadius.xl,
      borderTopRightRadius: borderRadius.xl,
      marginTop: -8,
      overflow: "hidden",
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: 40,
    },
    description: {
      fontSize: fontSize.sm,
      color: DOC_COLORS.secondaryText,
      marginBottom: spacing.md,
      lineHeight: 20,
    },
    errorBanner: {
      backgroundColor: DOC_COLORS.errorBackground,
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      marginBottom: spacing.md,
    },
    errorBannerText: {
      fontSize: fontSize.sm,
      color: DOC_COLORS.error,
    },
    infoBanner: {
      backgroundColor: DOC_COLORS.infoBadge,
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      marginBottom: spacing.md,
    },
    infoBannerText: {
      fontSize: fontSize.sm,
      color: DOC_COLORS.infoText,
    },
    stepCard: {
      backgroundColor: DOC_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: DOC_COLORS.border,
      padding: spacing.lg,
      marginBottom: spacing.md,
    },
    stepHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    stepNumber: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: DOC_COLORS.primaryCTA,
      alignItems: "center",
      justifyContent: "center",
    },
    stepNumberText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      color: DOC_COLORS.primaryCTAText,
    },
    stepTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: DOC_COLORS.primaryText,
    },
    stepDescription: {
      fontSize: fontSize.sm,
      color: DOC_COLORS.secondaryText,
      marginBottom: spacing.md,
      lineHeight: 20,
    },
    downloadButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: DOC_COLORS.card,
      borderWidth: 1,
      borderColor: DOC_COLORS.border,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    downloadButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: DOC_COLORS.primaryText,
    },
    uploadArea: {
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: DOC_COLORS.border,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
      alignItems: "center",
    },
    uploadPlaceholder: {
      alignItems: "center",
      gap: spacing.xs,
    },
    uploadPlaceholderText: {
      fontSize: fontSize.sm,
      color: DOC_COLORS.secondaryText,
      marginTop: spacing.sm,
    },
    uploadPlaceholderHint: {
      fontSize: fontSize.xs,
      color: DOC_COLORS.mutedText,
    },
    selectedFileContainer: {
      alignItems: "center",
      gap: spacing.xs,
    },
    fileIconSuccess: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: DOC_COLORS.successBadge,
      alignItems: "center",
      justifyContent: "center",
    },
    selectedFileName: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: DOC_COLORS.primaryText,
      marginTop: spacing.xs,
    },
    selectedFileSize: {
      fontSize: fontSize.xs,
      color: DOC_COLORS.mutedText,
    },
    primaryButton: {
      backgroundColor: DOC_COLORS.primaryCTA,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: DOC_COLORS.primaryCTAText,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    // Success state
    successContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.lg,
    },
    successIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: DOC_COLORS.successBadge,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
    },
    successTitle: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.semibold,
      color: DOC_COLORS.primaryText,
      marginBottom: spacing.sm,
    },
    successText: {
      fontSize: fontSize.base,
      color: DOC_COLORS.secondaryText,
      marginBottom: spacing.xl,
    },
    // Loading/Error states
    centered: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
      backgroundColor: DOC_COLORS.background,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: DOC_COLORS.error,
    },
  });
