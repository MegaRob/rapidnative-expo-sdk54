import {
  arrayRemove,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';

// Conditionally import Stripe — not available in Expo Go
const isExpoGo = Constants.appOwnership === 'expo';
let useStripe: any;
if (!isExpoGo) {
  try {
    useStripe = require('@stripe/stripe-react-native').useStripe;
  } catch {
    // Stripe not available
  }
}
const useStripeSafe = () => {
  if (useStripe) return useStripe();
  return { initPaymentSheet: async () => ({ error: { message: 'Stripe not available in Expo Go' } }), presentPaymentSheet: async () => ({ error: { message: 'Stripe not available in Expo Go' } }) };
};
import { Check, CreditCard, HeartPulse, ShieldCheck, Shirt, Trophy, User, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import KeyboardScreen from './KeyboardScreen';
import { auth, db, app } from '../../src/firebaseConfig';

// App ID from firebaseConfig
const APP_ID = '1:1048323489461:web:e3c514fcf0d7748ef848fc';

interface RegistrationFormProps {
  visible: boolean;
  onClose: () => void;
  race?: any; // Full trail/race object
  trail?: any; // Alternative prop name for race
  selectedDistance?: string;
  onRegistered?: (payload: {
    raceId: string;
    registrationId: string;
    simpleRegistrationId: string;
    bibNumber: string;
    shirtSize: string;
    startTime: string;
    firstName: string;
    lastName: string;
    fullName: string;
    registeredAt: Timestamp;
  }) => void;
}

type ShirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  shirtSize: ShirtSize | '';
  waiverAccepted: boolean;
}

interface FormErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  shirtSize?: string;
  waiverAccepted?: string;
}

export default function RegistrationForm({
  visible,
  onClose,
  race,
  trail,
  selectedDistance,
  onRegistered,
}: RegistrationFormProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { initPaymentSheet, presentPaymentSheet } = useStripeSafe();
  const functions = getFunctions(app);
  // Resolve race data from either prop name
  const resolvedRace = race || trail;
  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    shirtSize: '',
    waiverAccepted: false,
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedShirtSize, setSelectedShirtSize] = useState<ShirtSize | ''>('');

  const shirtSizes: ShirtSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  // Reset form when modal opens/closes
  useEffect(() => {
    if (visible) {
      // Always reset success state when modal opens to show the form
      setShowSuccess(false);
      setIsProcessing(false);
      // Pre-fill email from auth if available
      const user = auth.currentUser;
      if (user?.email) {
        setFormData(prev => ({ ...prev, email: user.email || '' }));
      }
      const fetchProfileDefaults = async () => {
        if (!user) return;
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            const resolvedFirstName =
              data.firstName ||
              (data.name ? String(data.name).split(' ')[0] : '') ||
              '';
            const resolvedLastName =
              data.lastName ||
              (data.name ? String(data.name).split(' ').slice(1).join(' ') : '') ||
              '';

            // Load saved registration info if available
            const saved = data.savedRegistrationInfo;

            setFormData(prev => ({
              ...prev,
              firstName: prev.firstName || resolvedFirstName,
              lastName: prev.lastName || resolvedLastName,
              phone: saved?.phone ? formatPhone(saved.phone) : prev.phone,
              emergencyContactName: saved?.emergencyContactName || prev.emergencyContactName,
              emergencyContactPhone: saved?.emergencyContactPhone ? formatPhone(saved.emergencyContactPhone) : prev.emergencyContactPhone,
              shirtSize: saved?.shirtSize || prev.shirtSize,
            }));

            if (saved?.shirtSize) {
              setSelectedShirtSize(saved.shirtSize);
            }
          }
        } catch (error) {
          console.error('Error pre-filling profile data:', error);
        }
      };
      fetchProfileDefaults();
    } else {
      // Reset form when closing
      setFormData({
        firstName: '',
        lastName: '',
        email: auth.currentUser?.email || '',
        phone: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        shirtSize: '',
        waiverAccepted: false,
      });
      setErrors({});
      setShowSuccess(false);
      setIsProcessing(false);
      setSelectedShirtSize('');
    }
  }, [visible]);

  // Email validation
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Phone validation (10 digits, allows formatting)
  const validatePhone = (phone: string): boolean => {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length === 10;
  };

  // Format phone number
  const formatPhone = (phone: string): string => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const generateBibNumber = (): string => {
    return `${Math.floor(1000 + Math.random() * 9000)}`;
  };

  // Validate form
  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }

    if (!formData.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone number is required';
    } else if (!validatePhone(formData.phone)) {
      newErrors.phone = 'Please enter a valid 10-digit phone number';
    }

    if (!formData.emergencyContactName.trim()) {
      newErrors.emergencyContactName = 'Emergency contact name is required';
    }

    if (!formData.emergencyContactPhone.trim()) {
      newErrors.emergencyContactPhone = 'Emergency contact phone is required';
    } else if (!validatePhone(formData.emergencyContactPhone)) {
      newErrors.emergencyContactPhone = 'Please enter a valid 10-digit phone number';
    }

    if (!formData.shirtSize) {
      newErrors.shirtSize = 'Shirt size is required';
    }

    if (!formData.waiverAccepted) {
      newErrors.waiverAccepted = 'You must accept the waiver to continue';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Check if form is valid (for button state)
  const isFormValid = (): boolean => {
    return (
      formData.firstName.trim() !== '' &&
      formData.lastName.trim() !== '' &&
      formData.email.trim() !== '' &&
      validateEmail(formData.email) &&
      formData.phone.trim() !== '' &&
      validatePhone(formData.phone) &&
      formData.emergencyContactName.trim() !== '' &&
      formData.emergencyContactPhone.trim() !== '' &&
      validatePhone(formData.emergencyContactPhone) &&
      formData.shirtSize !== '' &&
      formData.waiverAccepted
    );
  };

  // Handle phone input change with formatting
  const handlePhoneChange = (value: string, field: 'phone' | 'emergencyContactPhone') => {
    const formatted = formatPhone(value);
    setFormData(prev => ({ ...prev, [field]: formatted }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  // ─── Complete the registration in Firestore (called after payment or for free races) ───
  const completeRegistration = async (priceValue: number, paymentIntentId?: string) => {
    const raceId = resolvedRace.id || resolvedRace.trailId || '';
    const startTime = resolvedRace.startTime || resolvedRace.start_time || resolvedRace.start || '';
    const user = auth.currentUser!;

    const fullName = `${formData.firstName.trim()} ${formData.lastName.trim()}`.trim();
    const bibNumber = generateBibNumber();
    const registeredAt = Timestamp.now();

    const registrationData = {
      userId: user.uid,
      trailId: raceId,
      raceName: resolvedRace.name || 'Unknown Race',
      distance: selectedDistance || resolvedRace.distancesOffered?.[0] || resolvedRace.distance || 'Unknown',
      pricePaid: priceValue,
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      fullName: fullName,
      email: formData.email.trim().toLowerCase(),
      phone: formData.phone.replace(/\D/g, ''),
      shirtSize: formData.shirtSize,
      bibNumber: bibNumber,
      emergencyContact: {
        name: formData.emergencyContactName.trim(),
        phone: formData.emergencyContactPhone.replace(/\D/g, ''),
      },
      status: 'confirmed',
      paymentIntentId: paymentIntentId || null,
      timestamp: registeredAt,
      createdAt: registeredAt,
    };

    // 1. Detailed registration in artifacts
    const registrationId = `${Date.now()}_${user.uid}`;
    const registrationRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'registrations', registrationId);
    await setDoc(registrationRef, registrationData);

    // 2. Simple registration in registrations collection
    const distanceLabel = selectedDistance || resolvedRace.distancesOffered?.[0] || resolvedRace.distance || '';
    const simpleRegistrationRef = doc(collection(db, 'registrations'));
    await setDoc(simpleRegistrationRef, {
      userId: user.uid,
      trailId: raceId,
      registeredAt: registeredAt,
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      fullName: fullName,
      bibNumber: bibNumber,
      shirtSize: formData.shirtSize,
      startTime: startTime || '',
      distance: distanceLabel,
    });

    // Remove from matches (they're now registered)
    if (raceId) {
      const matchesQuery = query(
        collection(db, 'matches'),
        where('userId', '==', user.uid),
        where('trailId', '==', raceId)
      );
      const matchesSnapshot = await getDocs(matchesQuery);
      for (const matchDoc of matchesSnapshot.docs) {
        await deleteDoc(matchDoc.ref);
      }
      await updateDoc(doc(db, 'users', user.uid), {
        matchedTrails: arrayRemove(raceId),
      });
    }

    // Confirm payment in our records if applicable
    if (paymentIntentId) {
      try {
        const confirmPaymentFn = httpsCallable(functions, 'confirmPayment');
        await confirmPaymentFn({ paymentIntentId });
      } catch (e) {
        console.warn('Could not confirm payment record:', e);
      }
    }

    onRegistered?.({
      raceId, registrationId, simpleRegistrationId: simpleRegistrationRef.id,
      bibNumber, shirtSize: formData.shirtSize, startTime: startTime || '',
      firstName: formData.firstName.trim(), lastName: formData.lastName.trim(),
      fullName, registeredAt,
    });

    // Save/update registration info
    const userDocSnap = await getDoc(doc(db, 'users', user.uid));
    const hasSavedInfo = userDocSnap.exists() && userDocSnap.data()?.savedRegistrationInfo;

    const navigateToConfirmation = () => {
      setIsProcessing(false);
      setShowSuccess(false);
      onClose();
      router.push({
        pathname: '/registration-confirmation',
        params: {
          trailId: resolvedRace.id || resolvedRace.trailId || '',
          raceName: resolvedRace.name || 'Race',
          distance: selectedDistance || resolvedRace.distancesOffered?.[0] || resolvedRace.distance || 'Unknown',
          location: resolvedRace.location || '',
          date: resolvedRace.date || '',
          price: priceValue.toString(),
          simpleRegistrationId: simpleRegistrationRef.id,
          bibNumber,
          shirtSize: formData.shirtSize,
          startTime: startTime || '',
        },
      });
    };

    const savedRegInfo = {
      phone: formData.phone.replace(/\D/g, ''),
      emergencyContactName: formData.emergencyContactName.trim(),
      emergencyContactPhone: formData.emergencyContactPhone.replace(/\D/g, ''),
      shirtSize: formData.shirtSize,
    };

    if (!hasSavedInfo) {
      setIsProcessing(false);
      Alert.alert(
        'Save Registration Info?',
        'Would you like to save your details so future registrations auto-fill for you?',
        [
          { text: 'No Thanks', style: 'cancel', onPress: navigateToConfirmation },
          {
            text: 'Save',
            onPress: async () => {
              try { await updateDoc(doc(db, 'users', user.uid), { savedRegistrationInfo: savedRegInfo }); } catch (e) { console.error('Error saving:', e); }
              navigateToConfirmation();
            },
          },
        ]
      );
    } else {
      try { await updateDoc(doc(db, 'users', user.uid), { savedRegistrationInfo: savedRegInfo }); } catch (e) { console.error('Error updating:', e); }
      navigateToConfirmation();
    }
  };

  // ─── Handle form submission ────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!validateForm()) return;

    if (!resolvedRace) {
      Alert.alert('Error', 'Race data is missing. Please try again.');
      return;
    }

    const priceValue = resolvedRace?.price ? parseFloat(String(resolvedRace.price)) || 0 : 0;
    const raceId = resolvedRace.id || resolvedRace.trailId || '';

    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Error', 'You must be logged in to register.');
      return;
    }

    // Check for duplicate registration
    if (raceId) {
      const existingQuery = query(
        collection(db, 'registrations'),
        where('userId', '==', user.uid),
        where('trailId', '==', raceId)
      );
      const existingSnapshot = await getDocs(existingQuery);
      if (!existingSnapshot.empty) {
        Alert.alert('Already Registered', 'You are already registered for this race.');
        return;
      }
    }

    setIsProcessing(true);

    try {
      // Get the price for the selected distance
      const distancesArray = Array.isArray(resolvedRace?.distances) ? resolvedRace.distances : [];
      const selectedDistData = selectedDistance
        ? distancesArray.find((d: any) => d.label === selectedDistance)
        : distancesArray[0];
      const actualPrice = selectedDistData?.price
        ? parseFloat(String(selectedDistData.price)) || 0
        : priceValue;

      // ── FREE RACE: Register immediately ──────────────────────────────────
      if (actualPrice <= 0) {
        await completeRegistration(0);
        return;
      }

      // ── PAID RACE: Use Stripe Payment Sheet ──────────────────────────────
      try {
        // 1. Create PaymentIntent via Cloud Function
        const createPaymentIntentFn = httpsCallable(functions, 'createPaymentIntent');
        const result = await createPaymentIntentFn({
          trailId: raceId,
          distance: selectedDistance || '',
          amount: actualPrice,
        });
        const { clientSecret, ephemeralKey, customerId, paymentIntentId } = result.data as any;

        // 2. Initialize the Payment Sheet
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: clientSecret,
          customerEphemeralKeySecret: ephemeralKey,
          customerId: customerId,
          merchantDisplayName: 'TrailMatch',
          allowsDelayedPaymentMethods: false,
          style: 'alwaysDark',
        });

        if (initError) {
          console.error('Payment sheet init error:', initError);
          Alert.alert('Payment Error', 'Could not initialize payment. Please try again.');
          setIsProcessing(false);
          return;
        }

        // 3. Present the Payment Sheet to the user
        const { error: presentError } = await presentPaymentSheet();

        if (presentError) {
          if (presentError.code === 'Canceled') {
            // User cancelled — not an error
            setIsProcessing(false);
            return;
          }
          console.error('Payment sheet error:', presentError);
          Alert.alert('Payment Failed', presentError.message || 'Payment could not be completed.');
          setIsProcessing(false);
          return;
        }

        // 4. Payment succeeded! Complete the registration
        await completeRegistration(actualPrice, paymentIntentId);

      } catch (stripeError: any) {
        console.error('Stripe payment error:', stripeError);
        setIsProcessing(false);

        // Provide user-friendly error messages
        const errorMsg = stripeError?.message || '';
        if (errorMsg.includes('not configured')) {
          Alert.alert(
            'Payment Not Available',
            'Online payments are not yet set up for this race. Please contact the race director for registration.',
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert(
            'Payment Error',
            'There was an issue processing your payment. Please try again.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error: any) {
      console.error('Registration error:', error);
      setIsProcessing(false);
      Alert.alert(
        'Registration Failed',
        'There was an error processing your registration. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  // Get price for the selected distance (if available), else fall back to race-level price
  const distancesArray = Array.isArray(resolvedRace?.distances) ? resolvedRace.distances : [];
  const selectedDistData = selectedDistance
    ? distancesArray.find((d: any) => d.label === selectedDistance)
    : distancesArray[0];
  const price = selectedDistData?.price
    ? parseFloat(String(selectedDistData.price)) || 0
    : parseFloat(String(resolvedRace?.price)) || 0;
  const raceId = resolvedRace?.id || resolvedRace?.trailId;
  const raceName = resolvedRace?.name || 'Race';

  // Only show success screen if we've actually completed a registration
  // Always show form first when modal opens
  if (showSuccess && isProcessing === false) {
    return (
      <Modal 
        visible={visible} 
        animationType="slide" 
        transparent={false}
        onRequestClose={onClose}
      >
        <SafeAreaView className="flex-1 bg-slate-950">
          <View className="flex-1 justify-center items-center px-6">
            <View className="bg-emerald-500/20 rounded-full p-6 mb-6">
              <Trophy size={64} color="#10b981" />
            </View>
            <Text className="text-emerald-500 text-3xl font-bold text-center mb-4">
              Congratulations
            </Text>
            <Text className="text-white text-base text-center mb-8">
              Congratulations on registering for the race. We wish you the best of luck and have a blast!
            </Text>
            <TouchableOpacity
              onPress={() => {
                setShowSuccess(false);
                onClose();
              }}
              className="bg-emerald-500 px-8 py-4 rounded-2xl"
              activeOpacity={0.8}
            >
              <Text className="text-white text-lg font-bold">Done</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  // Always render the Modal - let the visible prop control it
  return (
    <Modal 
      visible={visible} 
      animationType="slide" 
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <SafeAreaView className="flex-1 bg-slate-950">
          {/* Header */}
          <View
            className="flex-row justify-between items-center px-6 py-4 border-b border-slate-800"
            style={{ paddingTop: insets.top }}
          >
            <Text className="text-emerald-500 text-2xl font-bold">Race Registration</Text>
            <TouchableOpacity onPress={onClose} disabled={isProcessing}>
              <X size={24} color="#10b981" />
            </TouchableOpacity>
          </View>

          <KeyboardScreen>
            {/* Race Info Summary - Show loading if race data not ready */}
            {!resolvedRace ? (
              <View className="bg-slate-900 mx-6 mt-6 p-4 rounded-2xl items-center">
                <ActivityIndicator size="large" color="#10b981" />
                <Text className="text-white mt-4">Loading race information...</Text>
              </View>
            ) : (
              <View className="bg-slate-900 mx-6 mt-6 p-4 rounded-2xl">
                <Text className="text-white text-xl font-bold mb-2">{raceName}</Text>
                {selectedDistance && (
                  <Text className="text-emerald-400 text-base mb-1">Distance: {selectedDistance}</Text>
                )}
                <Text className="text-emerald-500 text-2xl font-bold mt-2">
                  ${price.toFixed(2)}
                </Text>
              </View>
            )}

            {/* Personal Information Section */}
            <View className="px-6 mt-6">
              <View className="flex-row items-center mb-4">
                <User size={20} color="#10b981" />
                <Text className="text-emerald-500 text-lg font-bold ml-2">
                  Personal Information
                </Text>
              </View>

              <View className="mb-4">
                <TextInput
                  placeholder="First Name *"
                  placeholderTextColor="#64748b"
                  value={formData.firstName}
                  onChangeText={(text) => {
                    setFormData(prev => ({ ...prev, firstName: text }));
                    if (errors.firstName) {
                      setErrors(prev => ({ ...prev, firstName: undefined }));
                    }
                  }}
                  className="bg-slate-900 text-white px-4 py-4 rounded-2xl border border-slate-700"
                  style={{ color: '#ffffff' }}
                />
                {errors.firstName && (
                  <Text className="text-red-500 text-sm mt-1 ml-2">{errors.firstName}</Text>
                )}
              </View>

              <View className="mb-4">
                <TextInput
                  placeholder="Last Name *"
                  placeholderTextColor="#64748b"
                  value={formData.lastName}
                  onChangeText={(text) => {
                    setFormData(prev => ({ ...prev, lastName: text }));
                    if (errors.lastName) {
                      setErrors(prev => ({ ...prev, lastName: undefined }));
                    }
                  }}
                  className="bg-slate-900 text-white px-4 py-4 rounded-2xl border border-slate-700"
                  style={{ color: '#ffffff' }}
                />
                {errors.lastName && (
                  <Text className="text-red-500 text-sm mt-1 ml-2">{errors.lastName}</Text>
                )}
              </View>

              <View className="mb-4">
                <TextInput
                  placeholder="Email *"
                  placeholderTextColor="#64748b"
                  value={formData.email}
                  onChangeText={(text) => {
                    setFormData(prev => ({ ...prev, email: text }));
                    if (errors.email) {
                      setErrors(prev => ({ ...prev, email: undefined }));
                    }
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  className="bg-slate-900 text-white px-4 py-4 rounded-2xl border border-slate-700"
                  style={{ color: '#ffffff' }}
                />
                {errors.email && (
                  <Text className="text-red-500 text-sm mt-1 ml-2">{errors.email}</Text>
                )}
              </View>

              <View className="mb-6">
                <TextInput
                  placeholder="Phone Number *"
                  placeholderTextColor="#64748b"
                  value={formData.phone}
                  onChangeText={(text) => handlePhoneChange(text, 'phone')}
                  keyboardType="phone-pad"
                  maxLength={12}
                  className="bg-slate-900 text-white px-4 py-4 rounded-2xl border border-slate-700"
                  style={{ color: '#ffffff' }}
                />
                {errors.phone && (
                  <Text className="text-red-500 text-sm mt-1 ml-2">{errors.phone}</Text>
                )}
              </View>
            </View>

            {/* Emergency Contact Section */}
            <View className="px-6 mt-2">
              <View className="flex-row items-center mb-4">
                <HeartPulse size={20} color="#10b981" />
                <Text className="text-emerald-500 text-lg font-bold ml-2">
                  Emergency Contact
                </Text>
              </View>

              <View className="mb-4">
                <TextInput
                  placeholder="Contact Name *"
                  placeholderTextColor="#64748b"
                  value={formData.emergencyContactName}
                  onChangeText={(text) => {
                    setFormData(prev => ({ ...prev, emergencyContactName: text }));
                    if (errors.emergencyContactName) {
                      setErrors(prev => ({ ...prev, emergencyContactName: undefined }));
                    }
                  }}
                  className="bg-slate-900 text-white px-4 py-4 rounded-2xl border border-slate-700"
                  style={{ color: '#ffffff' }}
                />
                {errors.emergencyContactName && (
                  <Text className="text-red-500 text-sm mt-1 ml-2">
                    {errors.emergencyContactName}
                  </Text>
                )}
              </View>

              <View className="mb-6">
                <TextInput
                  placeholder="Contact Phone *"
                  placeholderTextColor="#64748b"
                  value={formData.emergencyContactPhone}
                  onChangeText={(text) => handlePhoneChange(text, 'emergencyContactPhone')}
                  keyboardType="phone-pad"
                  maxLength={12}
                  className="bg-slate-900 text-white px-4 py-4 rounded-2xl border border-slate-700"
                  style={{ color: '#ffffff' }}
                />
                {errors.emergencyContactPhone && (
                  <Text className="text-red-500 text-sm mt-1 ml-2">
                    {errors.emergencyContactPhone}
                  </Text>
                )}
              </View>
            </View>

            {/* Race Preferences Section */}
            <View className="px-6 mt-2">
              <View className="flex-row items-center mb-4">
                <Shirt size={20} color="#10b981" />
                <Text className="text-emerald-500 text-lg font-bold ml-2">
                  Race Preferences
                </Text>
              </View>

              <View className="flex-row flex-wrap gap-3 mb-6">
                {shirtSizes.map((size) => (
                  <TouchableOpacity
                    key={size}
                    onPress={() => {
                      setFormData(prev => ({ ...prev, shirtSize: size }));
                      setSelectedShirtSize(size);
                      if (errors.shirtSize) {
                        setErrors(prev => ({ ...prev, shirtSize: undefined }));
                      }
                    }}
                    className={`px-6 py-3 rounded-2xl border-2 ${
                      formData.shirtSize === size
                        ? 'bg-emerald-500 border-emerald-400'
                        : 'bg-slate-900 border-slate-700'
                    }`}
                  >
                    <Text
                      className={`font-bold ${
                        formData.shirtSize === size ? 'text-white' : 'text-gray-400'
                      }`}
                    >
                      {size}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {errors.shirtSize && (
                <Text className="text-red-500 text-sm mb-6 ml-2">{errors.shirtSize}</Text>
              )}
            </View>

            {/* Digital Waiver Section */}
            <View className="px-6 mt-2 mb-6">
              <View className="flex-row items-center mb-4">
                <ShieldCheck size={20} color="#10b981" />
                <Text className="text-emerald-500 text-lg font-bold ml-2">
                  Digital Waiver
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => {
                  setFormData(prev => ({ ...prev, waiverAccepted: !prev.waiverAccepted }));
                  if (errors.waiverAccepted) {
                    setErrors(prev => ({ ...prev, waiverAccepted: undefined }));
                  }
                }}
                className="flex-row items-start bg-slate-900 p-4 rounded-2xl border border-slate-700"
              >
                <View
                  className={`w-6 h-6 rounded border-2 mr-3 items-center justify-center mt-0.5 ${
                    formData.waiverAccepted
                      ? 'bg-emerald-500 border-emerald-400'
                      : 'border-slate-600'
                  }`}
                >
                  {formData.waiverAccepted && <Check size={16} color="#ffffff" />}
                </View>
                <Text className="text-white text-sm flex-1">
                  I acknowledge the risks of mountain ultra-running and agree to the Event Liability
                  Waiver. *
                </Text>
              </TouchableOpacity>
              {errors.waiverAccepted && (
                <Text className="text-red-500 text-sm mt-2 ml-2">{errors.waiverAccepted}</Text>
              )}
            </View>
            {/* Submit Button inside scroll */}
            <View className="px-6 py-4">
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!isFormValid() || isProcessing}
                className={`py-4 rounded-2xl items-center flex-row justify-center ${
                  isFormValid() && !isProcessing
                    ? 'bg-emerald-500'
                    : 'bg-slate-700 opacity-50'
                }`}
                activeOpacity={0.8}
              >
                {isProcessing ? (
                  <>
                    <ActivityIndicator color="#ffffff" size="small" />
                    <Text className="text-white text-lg font-bold ml-2">Processing...</Text>
                  </>
                ) : (
                  <>
                    <CreditCard size={20} color="white" />
                    <Text className="text-white text-lg font-bold ml-2">
                      Pay & Register ${price.toFixed(2)}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardScreen>
      </SafeAreaView>
    </Modal>
  );
}

