import { useRouter } from "expo-router";
import { updateProfile } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { ArrowRight, Check } from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
    Alert,
    Dimensions,
    FlatList,
  KeyboardAvoidingView,
  Platform,
    Image,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { auth, db } from "../src/firebaseConfig";
import { getCoordinatesForCity } from "../utils/geolocationUtils";
import LocationModal from "./components/LocationModal";
const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Slide = {
  id: string;
  title: string;
  description: string;
  image?: string;
  hasForm?: boolean;
  formType?: "name" | "location";
};

const slides: Slide[] = [
  {
    id: "welcome",
    title: "Welcome to TrailMatch!",
    description: "Discover your next trail and ultramarathon adventure.",
    image:
      "https://images.unsplash.com/photo-1635099404457-91c3d0dade3b?w=900&auto=format&fit=crop&q=60",
  },
  {
    id: "swipe",
    title: "Find Your Perfect Race",
    description: "Swipe right to save a race you love. Swipe left to pass.",
    image:
      "https://images.unsplash.com/photo-1595078475328-1ab05d0a6a0e?w=900&auto=format&fit=crop&q=60",
  },
  {
    id: "calendar",
    title: "Build Your Race Calendar",
    description: "All your saved races appear in your dashboard.",
    image:
      "https://images.unsplash.com/photo-1657087018695-a57e346504f9?w=900&auto=format&fit=crop&q=60",
  },
  {
    id: "profile",
    title: "Your Name",
    description: "Let other runners know who you are.",
    hasForm: true,
    formType: "name",
  },
  {
    id: "location",
    title: "Your Location",
    description: "Enter your city so we can personalize races nearby.",
    hasForm: true,
    formType: "location",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLon, setLocationLon] = useState<number | null>(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [bio, setBio] = useState("");
  const flatListRef = useRef<FlatList<Slide>>(null);

  const handleOnboardingComplete = async () => {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No user found");
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const coords =
        locationLat !== null && locationLon !== null
          ? { lat: locationLat, lon: locationLon }
          : locationName.trim()
            ? getCoordinatesForCity(locationName.trim())
            : null;

      // 1. Update the Firebase Auth profile
      await updateProfile(user, {
        displayName: fullName || user.displayName || "", // 'name' from component state
      });

      // 2. Update the Firestore document
      const userDocRef = doc(db, "users", user.uid);
      await updateDoc(userDocRef, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: fullName,
        locationName: locationName.trim(),
        ...(coords ? { latitude: coords.lat, longitude: coords.lon } : {}),
        bio: bio, // 'bio' from component state
        onboardingComplete: true,
      });

      router.replace("/(tabs)");
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      Alert.alert("Error", "Could not complete onboarding. Please try again.");
    }
  };

  // Index of the "Your Name" slide — users must fill this out
  const nameSlideIndex = slides.findIndex((s) => s.formType === "name");

  const handleSkip = () => {
    // Skip intro slides and go straight to the required name form
    flatListRef.current?.scrollToIndex({ animated: true, index: nameSlideIndex });
  };

  const handleNext = () => {
    const currentSlide = slides[currentIndex];
    if (currentSlide?.formType === "name") {
      if (!firstName.trim() || !lastName.trim()) {
        Alert.alert("Missing details", "Please enter your first and last name.");
        return;
      }
    }
    if (currentSlide?.formType === "location") {
      if (!locationName.trim()) {
        Alert.alert("Missing details", "Please enter your city and state.");
        return;
      }
      if (locationLat === null || locationLon === null) {
        const coords = getCoordinatesForCity(locationName.trim());
        if (!coords) {
          Alert.alert(
            "Location not found",
            "We couldn't find that location. Try using the location picker or a nearby city (e.g., Logan, UT)."
          );
          return;
        }
        setLocationLat(coords.lat);
        setLocationLon(coords.lon);
      }
    }
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    } else {
      handleOnboardingComplete();
    }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
    }
  });

  const renderSlide = ({ item }: { item: Slide }) => (
    <ScrollView
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: item.hasForm ? 'flex-start' : 'center', padding: 32, paddingBottom: 100 }}
      style={{ width: SCREEN_WIDTH }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {item.image && (
        <View className="w-48 h-48 rounded-full overflow-hidden mb-8 bg-gray-800">
          <Image source={{ uri: item.image }} className="w-full h-full" />
        </View>
      )}

      <Text className="text-3xl font-bold text-white mb-4 text-center">
        {item.title}
      </Text>
      <Text className="text-lg text-gray-300 text-center px-4">
        {item.description}
      </Text>

      {item.hasForm && item.formType === "name" && (
        <View className="w-full mt-10 space-y-4">
          <View>
            <Text className="text-gray-300 mb-2">First Name</Text>
            <TextInput
              className="bg-gray-800 rounded-xl p-4 text-white"
              placeholder="Enter your first name"
              placeholderTextColor="#9CA3AF"
              value={firstName}
              onChangeText={setFirstName}
            />
          </View>

          <View>
            <Text className="text-gray-300 mb-2">Last Name</Text>
            <TextInput
              className="bg-gray-800 rounded-xl p-4 text-white"
              placeholder="Enter your last name"
              placeholderTextColor="#9CA3AF"
              value={lastName}
              onChangeText={setLastName}
            />
          </View>

          <View>
            <Text className="text-gray-300 mb-2">Bio</Text>
            <TextInput
              className="bg-gray-800 rounded-xl p-4 text-white h-24"
              placeholder="Tell us about yourself"
              placeholderTextColor="#9CA3AF"
              value={bio}
              onChangeText={setBio}
              multiline
              textAlignVertical="top"
            />
          </View>

        </View>
      )}

      {item.hasForm && item.formType === "location" && (
        <View className="w-full mt-10 space-y-4">
          <View>
            <Text className="text-gray-300 mb-2">Location</Text>
            <TextInput
              className="bg-gray-800 rounded-xl p-4 text-white"
              placeholder="e.g., Logan, UT"
              placeholderTextColor="#9CA3AF"
              value={locationName}
              onChangeText={setLocationName}
              autoCapitalize="words"
            />
            <Text className="text-gray-500 text-xs mt-2">
              We use this to personalize races near you.
            </Text>
          </View>
          <TouchableOpacity
            className="bg-gray-800 rounded-xl p-4 items-center"
            onPress={() => setShowLocationModal(true)}
          >
            <Text className="text-white font-semibold">Use GPS or Search</Text>
          </TouchableOpacity>
          {locationLat !== null && locationLon !== null && (
            <Text className="text-green-400 text-xs">
              Location set successfully.
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );

  return (
    <View className="flex-1 bg-gray-900">
      {currentIndex < nameSlideIndex && (
        <TouchableOpacity
          className="absolute top-12 right-6 z-10"
          onPress={handleSkip}
        >
          <Text className="text-green-400 font-semibold">Skip</Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={slides}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged.current}
          keyboardShouldPersistTaps="handled"
        />
      </KeyboardAvoidingView>

      <View className="absolute bottom-8 left-0 right-0">
        <View className="flex-row justify-center items-center mb-6">
          {slides.map((slide, index) => (
            <View
              key={slide.id}
              className={`w-3 h-3 rounded-full mx-1 ${
                index === currentIndex ? "bg-green-400" : "bg-gray-700"
              }`}
            />
          ))}
        </View>

        <View className="flex-row justify-center">
          <TouchableOpacity
            className="bg-green-500 rounded-full w-14 h-14 items-center justify-center"
            onPress={handleNext}
          >
            {currentIndex < slides.length - 1 ? (
              <ArrowRight color="white" size={24} />
            ) : (
              <Check color="white" size={24} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <LocationModal
        visible={showLocationModal}
        currentLocationName={locationName}
        onClose={() => setShowLocationModal(false)}
        onLocationSet={(name, lat, lon) => {
          setLocationName(name);
          setLocationLat(lat);
          setLocationLon(lon);
        }}
      />
    </View>
  );
}