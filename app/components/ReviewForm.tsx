import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Star } from 'lucide-react-native';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '../../src/firebaseConfig';
import StandardBottomSheet, {
  StandardBottomSheetHandle,
} from './StandardBottomSheet';

/* ── Public handle ──────────────────────────────────────────────────── */
export interface ReviewFormHandle {
  /** Open the review sheet */
  present: () => void;
  /** Close the review sheet */
  close: () => void;
}

/* ── Props ──────────────────────────────────────────────────────────── */
interface ReviewFormProps {
  trailId: string;
  raceName: string;
  /** Called after a review is successfully submitted */
  onReviewSubmitted?: () => void;
  /** Called when the sheet is dismissed */
  onClose?: () => void;
}

/* ── Component ──────────────────────────────────────────────────────── */
const ReviewForm = forwardRef<ReviewFormHandle, ReviewFormProps>(
  ({ trailId, raceName, onReviewSubmitted, onClose }, ref) => {
    const [rating, setRating] = useState(0);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [saving, setSaving] = useState(false);
    const [existingReviewId, setExistingReviewId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    const sheetRef = useRef<StandardBottomSheetHandle>(null);

    // ── Expose present / close to the parent via ref ────────────────
    React.useImperativeHandle(ref, () => ({
      present: () => {
        setIsOpen(true);
        sheetRef.current?.present();
      },
      close: () => {
        sheetRef.current?.close();
      },
    }));

    // ── Fetch existing review when the sheet opens ──────────────────
    useEffect(() => {
      if (!isOpen) return;
      const uid = auth.currentUser?.uid;
      if (!uid || !trailId) {
        setLoading(false);
        return;
      }
      setLoading(true);

      const fetchExisting = async () => {
        try {
          const q = query(
            collection(db, 'reviews'),
            where('userId', '==', uid),
            where('trailId', '==', trailId)
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            const reviewDoc = snap.docs[0];
            const data = reviewDoc.data();
            setExistingReviewId(reviewDoc.id);
            setRating(data.rating || 0);
            setTitle(data.title || '');
            setBody(data.body || '');
          } else {
            setExistingReviewId(null);
            setRating(0);
            setTitle('');
            setBody('');
          }
        } catch (error) {
          console.error('Error loading existing review:', error);
        } finally {
          setLoading(false);
        }
      };

      fetchExisting();
    }, [isOpen, trailId]);

    // ── Submit handler ──────────────────────────────────────────────
    const handleSubmit = async () => {
      if (rating === 0) {
        Alert.alert('Rating Required', 'Please select a star rating.');
        return;
      }
      const uid = auth.currentUser?.uid;
      if (!uid) {
        Alert.alert('Error', 'You must be logged in to leave a review.');
        return;
      }

      setSaving(true);
      try {
        const reviewData = {
          userId: uid,
          trailId,
          rating,
          title: title.trim(),
          body: body.trim(),
          updatedAt: Timestamp.now(),
        };

        if (existingReviewId) {
          await updateDoc(doc(db, 'reviews', existingReviewId), reviewData);
        } else {
          await addDoc(collection(db, 'reviews'), {
            ...reviewData,
            createdAt: Timestamp.now(),
          });
        }

        await updateAggregateRating(trailId);
        onReviewSubmitted?.();
        sheetRef.current?.close();
      } catch (error) {
        console.error('Error submitting review:', error);
        Alert.alert('Error', 'Failed to submit review. Please try again.');
      } finally {
        setSaving(false);
      }
    };

    // ── Sheet dismiss callback ──────────────────────────────────────
    const handleClose = useCallback(() => {
      setIsOpen(false);
      onClose?.();
    }, [onClose]);

    // ── Rating label ────────────────────────────────────────────────
    const ratingLabel =
      rating === 0
        ? 'Tap a star to rate'
        : rating === 1
        ? 'Poor'
        : rating === 2
        ? 'Fair'
        : rating === 3
        ? 'Good'
        : rating === 4
        ? 'Great'
        : 'Amazing!';

    // ── Render ──────────────────────────────────────────────────────
    return (
      <StandardBottomSheet
        ref={sheetRef}
        title={existingReviewId ? 'Edit Your Review' : 'Rate This Race'}
        snapPoints={['50%', '90%']}
        onClose={handleClose}
      >
        {loading ? (
          <ActivityIndicator
            size="large"
            color="#10B981"
            style={{ marginVertical: 40 }}
          />
        ) : (
          <>
            {/* Race Name */}
            <Text style={{ color: '#94A3B8', fontSize: 14, marginBottom: 16 }}>
              {raceName}
            </Text>

            {/* Star Rating */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
                marginBottom: 24,
              }}
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => setRating(star)} hitSlop={8}>
                  <Star
                    size={36}
                    color={star <= rating ? '#FBBF24' : '#475569'}
                    fill={star <= rating ? '#FBBF24' : 'transparent'}
                  />
                </Pressable>
              ))}
            </View>

            {/* Rating Label */}
            <Text
              style={{
                color: '#94A3B8',
                textAlign: 'center',
                marginBottom: 20,
                fontSize: 14,
              }}
            >
              {ratingLabel}
            </Text>

            {/* Title — BottomSheetTextInput for native keyboard avoidance */}
            <BottomSheetTextInput
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 12,
                padding: 14,
                color: '#FFFFFF',
                fontSize: 15,
                borderWidth: 1,
                borderColor: 'rgba(71, 85, 105, 0.5)',
                marginBottom: 12,
              }}
              placeholder="Review title (optional)"
              placeholderTextColor="#64748B"
              selectionColor="#10B981"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
              onFocus={() => requestAnimationFrame(() => sheetRef.current?.expand())}
            />

            {/* Body — BottomSheetTextInput for native keyboard avoidance */}
            <BottomSheetTextInput
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 12,
                padding: 14,
                color: '#FFFFFF',
                fontSize: 15,
                height: 120,
                borderWidth: 1,
                borderColor: 'rgba(71, 85, 105, 0.5)',
                marginBottom: 20,
                textAlignVertical: 'top',
              }}
              placeholder="Tell others about your experience..."
              placeholderTextColor="#64748B"
              selectionColor="#10B981"
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={1000}
              onFocus={() => requestAnimationFrame(() => sheetRef.current?.expand())}
            />

            {/* Submit */}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={saving}
              style={{
                backgroundColor: '#10B981',
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: 'center',
              }}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>
                  {existingReviewId ? 'Update Review' : 'Submit Review'}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </StandardBottomSheet>
    );
  }
);

ReviewForm.displayName = 'ReviewForm';
export default ReviewForm;

/* ── Aggregate helper (unchanged) ───────────────────────────────────── */
async function updateAggregateRating(trailId: string) {
  try {
    const reviewsQuery = query(
      collection(db, 'reviews'),
      where('trailId', '==', trailId)
    );
    const snap = await getDocs(reviewsQuery);
    if (snap.empty) return;

    let total = 0;
    snap.docs.forEach((d) => {
      total += d.data().rating || 0;
    });
    const avgRating = total / snap.size;
    const reviewCount = snap.size;

    const trailRef = doc(db, 'trails', trailId);
    await updateDoc(trailRef, {
      avgRating: Math.round(avgRating * 10) / 10,
      reviewCount,
    });
  } catch (error) {
    console.error('Error updating aggregate rating:', error);
  }
}
