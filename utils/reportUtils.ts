import { collection, doc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../src/firebaseConfig';

// App ID from firebaseConfig
const APP_ID = '1:1048323489461:web:e3c514fcf0d7748ef848fc';

export type ReportReason = 'Spam' | 'Harassment' | 'Inappropriate Content' | 'Inappropriate Profile' | 'Other';

export interface ReportData {
  reporterId: string;
  reportedUserId: string;
  reason: ReportReason;
  details: string;
  chatId?: string;
  timestamp: any; // Firestore Timestamp
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
}

/**
 * Submit a report for a user
 */
export async function submitReport(
  reportedUserId: string,
  reason: ReportReason,
  details: string,
  chatId?: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User must be authenticated to submit a report');
  }

  if (currentUser.uid === reportedUserId) {
    throw new Error('Cannot report yourself');
  }

  // Create a unique report document ID (using timestamp + reporter ID for uniqueness)
  const reportId = `${Date.now()}_${currentUser.uid}`;
  const reportDocRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'reports', reportId);

  const reportData: ReportData = {
    reporterId: currentUser.uid,
    reportedUserId: reportedUserId,
    reason: reason,
    details: details.trim(),
    timestamp: Timestamp.now(),
    status: 'pending',
  };

  // Add chatId if provided
  if (chatId) {
    reportData.chatId = chatId;
  }

  try {
    await setDoc(reportDocRef, reportData);
    console.log('Successfully submitted report:', reportId);
  } catch (error: any) {
    console.error('Error submitting report:', error);
    throw error;
  }
}









