import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Alert, ActivityIndicator } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { submitReport, ReportReason } from '../../utils/reportUtils';
import { blockUser } from '../../utils/blockUtils';
import { useRouter } from 'expo-router';

interface ReportModalProps {
  visible: boolean;
  reportedUserId: string;
  reportedUserName: string;
  chatId?: string;
  onClose: () => void;
  onReportSubmitted?: () => void;
}

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'Spam', label: 'Spam' },
  { value: 'Harassment', label: 'Harassment' },
  { value: 'Inappropriate Content', label: 'Inappropriate Content' },
  { value: 'Inappropriate Profile', label: 'Inappropriate Profile' },
  { value: 'Other', label: 'Other' },
];

export default function ReportModal({
  visible,
  reportedUserId,
  reportedUserName,
  chatId,
  onClose,
  onReportSubmitted,
}: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showThankYou, setShowThankYou] = useState(false);
  const router = useRouter();

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
            handleClose();
            // Navigate back to prevent further interaction
            router.back();
          },
        },
      ]);
    } catch (error: any) {
      console.error('Error blocking user after report:', error);
      Alert.alert('Error', 'Report submitted successfully, but failed to block user.');
      handleClose();
      router.back();
    }
  };

  const handleClose = () => {
    setShowThankYou(false);
    setSelectedReason(null);
    setDetails('');
    setSubmitting(false);
    onClose();
  };

  const handleSkipBlock = () => {
    handleClose();
    // Navigate back to prevent further interaction
    router.back();
  };

  if (showThankYou) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        transparent={false}
        onRequestClose={handleClose}
      >
        <SafeAreaView className="flex-1 bg-gray-900">
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-white text-2xl font-bold mb-4 text-center">
              Thank You
            </Text>
            <Text className="text-gray-300 text-base text-center mb-8 leading-6">
              Thank you for looking out for the community. We have received your report and will review it shortly.
            </Text>
            
            <Text className="text-white text-lg font-semibold mb-4 text-center">
              Would you also like to block this user?
            </Text>
            
            <View className="w-full">
              <Pressable
                onPress={handleBlockAfterReport}
                className="w-full bg-red-500 py-4 rounded-lg items-center mb-3"
              >
                <Text className="text-white text-lg font-bold">Yes, Block User</Text>
              </Pressable>
              
              <Pressable
                onPress={handleSkipBlock}
                className="w-full bg-gray-700 py-4 rounded-lg items-center"
              >
                <Text className="text-white text-lg font-semibold">No, Continue</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <SafeAreaView className="flex-1 bg-gray-900">
        {/* Header */}
        <View className="flex-row justify-between items-center p-4 border-b border-gray-700">
          <Text className="text-white text-xl font-bold">Report User</Text>
          <Pressable
            onPress={handleClose}
            className="w-10 h-10 items-center justify-center rounded-full bg-gray-800"
          >
            <X size={24} color="#fff" />
          </Pressable>
        </View>

        <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24 }} keyboardShouldPersistTaps="handled" bottomOffset={40}>
          <Text className="text-gray-300 text-base mb-6">
            Reporting: <Text className="text-white font-semibold">{reportedUserName}</Text>
          </Text>

          {/* Reason Selection */}
          <Text className="text-white text-lg font-semibold mb-4">Reason for Report</Text>
          <View className="mb-6">
            {REPORT_REASONS.map((reason) => (
              <Pressable
                key={reason.value}
                onPress={() => setSelectedReason(reason.value)}
                className={`mb-3 p-4 rounded-lg border-2 ${
                  selectedReason === reason.value
                    ? 'bg-green-500/20 border-green-500'
                    : 'bg-gray-800 border-gray-700'
                }`}
              >
                <Text
                  className={`text-base ${
                    selectedReason === reason.value ? 'text-green-400 font-semibold' : 'text-white'
                  }`}
                >
                  {reason.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Details Input */}
          <Text className="text-white text-lg font-semibold mb-4">Additional Details</Text>
          <TextInput
            className="bg-gray-800 rounded-lg p-4 text-white text-base min-h-32"
            placeholder="Please provide more context about the issue..."
            placeholderTextColor="#9CA3AF"
            value={details}
            onChangeText={setDetails}
            multiline
            textAlignVertical="top"
            style={{ minHeight: 120 }}
          />

          {/* Submit Button */}
          <Pressable
            onPress={handleSubmit}
            disabled={submitting || !selectedReason || details.trim().length === 0}
            className={`w-full py-4 rounded-lg items-center mt-6 mb-8 ${
              submitting || !selectedReason || details.trim().length === 0
                ? 'bg-gray-700'
                : 'bg-red-500'
            }`}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="text-white text-lg font-bold">Submit Report</Text>
            )}
          </Pressable>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </Modal>
  );
}









