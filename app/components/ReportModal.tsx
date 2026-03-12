import React, { forwardRef, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { submitReport, ReportReason } from '../../utils/reportUtils';
import { blockUser } from '../../utils/blockUtils';
import { useRouter } from 'expo-router';
import StandardBottomSheet, { StandardBottomSheetHandle } from './StandardBottomSheet';

/* ── Public handle exposed via ref ──────────────────────────────────── */
export interface ReportModalHandle {
  present: () => void;
  close: () => void;
}

interface ReportModalProps {
  reportedUserId: string;
  reportedUserName: string;
  chatId?: string;
  onClose?: () => void;
  onReportSubmitted?: () => void;
}

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'Spam', label: 'Spam' },
  { value: 'Harassment', label: 'Harassment' },
  { value: 'Inappropriate Content', label: 'Inappropriate Content' },
  { value: 'Inappropriate Profile', label: 'Inappropriate Profile' },
  { value: 'Other', label: 'Other' },
];

const ReportModal = forwardRef<ReportModalHandle, ReportModalProps>(
  ({ reportedUserId, reportedUserName, chatId, onClose, onReportSubmitted }, ref) => {
    const sheetRef = useRef<StandardBottomSheetHandle>(null);
    const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
    const [details, setDetails] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showThankYou, setShowThankYou] = useState(false);
    const router = useRouter();

    // Expose present / close to parent via ref
    React.useImperativeHandle(ref, () => ({
      present: () => {
        // Reset state on open
        setSelectedReason(null);
        setDetails('');
        setSubmitting(false);
        setShowThankYou(false);
        sheetRef.current?.present();
      },
      close: () => {
        sheetRef.current?.close();
      },
    }));

    const handleSubmit = async () => {
      if (!selectedReason) {
        Alert.alert('Please Select a Reason', 'Please select a reason for reporting this user.');
        return;
      }

      if (details.trim().length === 0) {
        Alert.alert('Details Required', 'Please provide additional details about the issue.');
        return;
      }

      setSubmitting(true);
      try {
        await submitReport(reportedUserId, selectedReason, details, chatId);
        setShowThankYou(true);
      } catch (error: any) {
        console.error('Error submitting report:', error);
        Alert.alert('Error', error.message || 'Failed to submit report. Please try again.');
        setSubmitting(false);
      }
    };

    const handleBlockAfterReport = async () => {
      try {
        await blockUser(reportedUserId);
        Alert.alert('User Blocked', `${reportedUserName} has been blocked.`, [
          {
            text: 'OK',
            onPress: () => {
              handleDismiss();
              router.back();
            },
          },
        ]);
      } catch (error: any) {
        console.error('Error blocking user after report:', error);
        Alert.alert('Error', 'Report submitted successfully, but failed to block user.');
        handleDismiss();
        router.back();
      }
    };

    const handleDismiss = useCallback(() => {
      setShowThankYou(false);
      setSelectedReason(null);
      setDetails('');
      setSubmitting(false);
      onClose?.();
    }, [onClose]);

    const handleSkipBlock = () => {
      handleDismiss();
      sheetRef.current?.close();
      router.back();
    };

    if (showThankYou) {
      return (
        <StandardBottomSheet
          ref={sheetRef}
          title="Thank You"
          snapPoints={['50%', '70%']}
          onClose={handleDismiss}
        >
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <Text style={{ color: '#D1D5DB', fontSize: 16, textAlign: 'center', marginBottom: 32, lineHeight: 24 }}>
              Thank you for looking out for the community. We have received your report and will review it shortly.
            </Text>

            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 16, textAlign: 'center' }}>
              Would you also like to block this user?
            </Text>

            <View style={{ width: '100%' }}>
              <Pressable
                onPress={handleBlockAfterReport}
                style={{
                  width: '100%',
                  backgroundColor: '#EF4444',
                  paddingVertical: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>Yes, Block User</Text>
              </Pressable>

              <Pressable
                onPress={handleSkipBlock}
                style={{
                  width: '100%',
                  backgroundColor: '#334155',
                  paddingVertical: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600' }}>No, Continue</Text>
              </Pressable>
            </View>
          </View>
        </StandardBottomSheet>
      );
    }

    return (
      <StandardBottomSheet
        ref={sheetRef}
        title="Report User"
        snapPoints={['65%', '90%']}
        onClose={handleDismiss}
      >
        <Text style={{ color: '#D1D5DB', fontSize: 16, marginBottom: 24 }}>
          Reporting: <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{reportedUserName}</Text>
        </Text>

        {/* Reason Selection */}
        <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 16 }}>
          Reason for Report
        </Text>
        <View style={{ marginBottom: 24 }}>
          {REPORT_REASONS.map((reason) => (
            <Pressable
              key={reason.value}
              onPress={() => setSelectedReason(reason.value)}
              style={{
                marginBottom: 12,
                padding: 16,
                borderRadius: 8,
                borderWidth: 2,
                borderColor: selectedReason === reason.value ? '#10B981' : '#334155',
                backgroundColor: selectedReason === reason.value ? 'rgba(16, 185, 129, 0.2)' : '#0F172A',
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  color: selectedReason === reason.value ? '#34D399' : '#FFFFFF',
                  fontWeight: selectedReason === reason.value ? '600' : '400',
                }}
              >
                {reason.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Details Input */}
        <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '600', marginBottom: 16 }}>
          Additional Details
        </Text>
        <BottomSheetTextInput
          style={{
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            borderRadius: 12,
            padding: 16,
            color: '#FFFFFF',
            fontSize: 16,
            minHeight: 120,
            borderWidth: 1,
            borderColor: 'rgba(71, 85, 105, 0.5)',
            textAlignVertical: 'top',
          }}
          placeholder="Please provide more context about the issue..."
          placeholderTextColor="#64748B"
          selectionColor="#10B981"
          value={details}
          onChangeText={setDetails}
          multiline
          onFocus={() => requestAnimationFrame(() => sheetRef.current?.expand())}
        />

        {/* Submit Button */}
        <Pressable
          onPress={handleSubmit}
          disabled={submitting || !selectedReason || details.trim().length === 0}
          style={{
            width: '100%',
            paddingVertical: 16,
            borderRadius: 8,
            alignItems: 'center',
            marginTop: 24,
            marginBottom: 16,
            backgroundColor:
              submitting || !selectedReason || details.trim().length === 0 ? '#334155' : '#EF4444',
          }}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>Submit Report</Text>
          )}
        </Pressable>
      </StandardBottomSheet>
    );
  }
);

ReportModal.displayName = 'ReportModal';
export default ReportModal;
