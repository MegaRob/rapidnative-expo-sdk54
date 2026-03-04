import { useRouter } from "expo-router";
import { updateProfile } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import {
  ArrowRight,
  Check,
  Compass,
  Heart,
  MapPin,
  Mountain,
  Route,
  Users,
} from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { auth, db } from "../src/firebaseConfig";
import { getCoordinatesForCity } from "../utils/geolocationUtils";
import LocationModal from "./components/LocationModal";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

type SlideType = "hero" | "feature" | "form_name" | "form_location" | "form_preferences" | "ready";

type Slide = {
  id: string;
  type: SlideType;
  title: string;
  subtitle: string;
  image?: string;
  icon?: React.ReactNode;
  gradientColors?: readonly [string, string, ...string[]];
};

const slides: Slide[] = [
  {
    id: "welcome",
    type: "hero",
    title: "Welcome to\nTrailMatch",
    subtitle: "Discover trail races you'll love — with a simple swipe.",
    image: "https://images.unsplash.com/photo-1635099404457-91c3d0dade3b?w=1200&auto=format&fit=crop&q=80",
    gradientColors: ["transparent", "rgba(0,0,0,0.3)", "rgba(15,23,42,0.95)", "#0F172A"],
  },
  {
    id: "swipe",
    type: "feature",
    title: "Swipe to Discover",
    subtitle: "Swipe right on races you love.\nSwipe left to skip.\nIt's that simple.",
    icon: <Heart color="#F43F5E" size={48} />,
    gradientColors: ["#0F172A", "#1E293B", "#0F172A"],
  },
  {
    id: "connect",
    type: "feature",
    title: "Find Running Buddies",
    subtitle: "Chat with runners doing the same race.\nFind pacers, carpool, or just make friends.",
    icon: <Users color="#10B981" size={48} />,
    gradientColors: ["#0F172A", "#1E293B", "#0F172A"],
  },
  {
    id: "profile",
    type: "form_name",
    title: "About You",
    subtitle: "Let other runners know who you are.",
    gradientColors: ["#0F172A", "#1E293B", "#0F172A"],
  },
  {
    id: "location",
    type: "form_location",
    title: "Your Home Base",
    subtitle: "We'll show you races near your area first.",
    gradientColors: ["#0F172A", "#1E293B", "#0F172A"],
  },
  {
    id: "preferences",
    type: "form_preferences",
    title: "Your Preferences",
    subtitle: "Help us find your perfect races.",
    gradientColors: ["#0F172A", "#1E293B", "#0F172A"],
  },
  {
    id: "ready",
    type: "ready",
    title: "You're All Set!",
    subtitle: "Start swiping to find your next race adventure.",
    image: "https://images.unsplash.com/photo-1657087018695-a57e346504f9?w=1200&auto=format&fit=crop&q=80",
    gradientColors: ["transparent", "rgba(0,0,0,0.3)", "rgba(15,23,42,0.95)", "#0F172A"],
  },
];

// Options for preferences
const DISTANCE_OPTIONS = [
  { value: "5K-25K", label: "5K – 25K", desc: "Short" },
  { value: "50K", label: "50K", desc: "Ultra" },
  { value: "100K", label: "100K", desc: "Long Ultra" },
  { value: "100M+", label: "100M+", desc: "Mega" },
];

const DIFFICULTY_OPTIONS = [
  { value: "Easy/Fire Road", label: "Easy", desc: "Fire roads & flat" },
  { value: "Moderate/Mountain", label: "Moderate", desc: "Mountain trails" },
  { value: "Technical/Skyrunning", label: "Technical", desc: "Skyrunning & technical" },
];

const RADIUS_OPTIONS = [
  { value: 50, label: "50 mi", desc: "Local" },
  { value: 100, label: "100 mi", desc: "Regional" },
  { value: 250, label: "250 mi", desc: "Extended" },
  { value: 0, label: "Global", desc: "Everywhere" },
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
  const [isSaving, setIsSaving] = useState(false);

  // Preferences
  const [prefDistance, setPrefDistance] = useState<string | null>(null);
  const [prefDifficulty, setPrefDifficulty] = useState<string | null>(null);
  const [prefRadius, setPrefRadius] = useState<number>(0);

  const flatListRef = useRef<FlatList<Slide>>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Animate progress bar
  useEffect(() => {
    Animated.spring(progressAnim, {
      toValue: (currentIndex + 1) / slides.length,
      tension: 40,
      friction: 10,
      useNativeDriver: false,
    }).start();
  }, [currentIndex]);

  // Find the first form slide index (for Skip button logic)
  const firstFormIndex = slides.findIndex(
    (s) => s.type === "form_name" || s.type === "form_location" || s.type === "form_preferences"
  );

  const handleOnboardingComplete = async () => {
    if (isSaving) return;
    setIsSaving(true);
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
        displayName: fullName || user.displayName || "",
      });

      // 2. Update the Firestore document with profile + preferences
      const userDocRef = doc(db, "users", user.uid);
      await updateDoc(userDocRef, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: fullName,
        locationName: locationName.trim(),
        ...(coords ? { latitude: coords.lat, longitude: coords.lon } : {}),
        bio: bio.trim(),
        preferredDistance: prefDistance,
        preferredDifficulty: prefDifficulty,
        preferredRadius: prefRadius,
        onboardingComplete: true,
      });

      router.replace("/(tabs)");
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      Alert.alert("Error", "Could not complete onboarding. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = () => {
    flatListRef.current?.scrollToIndex({ animated: true, index: firstFormIndex });
  };

  const handleNext = () => {
    const currentSlide = slides[currentIndex];

    // Validate name form
    if (currentSlide?.type === "form_name") {
      if (!firstName.trim() || !lastName.trim()) {
        Alert.alert("Missing details", "Please enter your first and last name.");
        return;
      }
    }

    // Validate location form
    if (currentSlide?.type === "form_location") {
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

  // --- Chip selector component ---
  const ChipSelector = ({
    options,
    selected,
    onSelect,
  }: {
    options: { value: any; label: string; desc: string }[];
    selected: any;
    onSelect: (val: any) => void;
  }) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <Pressable
            key={String(opt.value)}
            onPress={() => onSelect(isSelected ? null : opt.value)}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 14,
              borderRadius: 16,
              backgroundColor: isSelected ? "rgba(16, 185, 129, 0.2)" : "rgba(30, 41, 59, 0.6)",
              borderWidth: 1.5,
              borderColor: isSelected ? "#10B981" : "rgba(71, 85, 105, 0.4)",
              minWidth: 90,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: isSelected ? "#10B981" : "#E2E8F0",
                fontWeight: "700",
                fontSize: 15,
              }}
            >
              {opt.label}
            </Text>
            <Text
              style={{
                color: isSelected ? "rgba(16, 185, 129, 0.7)" : "#64748B",
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {opt.desc}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  // --- Render individual slides ---
  const renderSlide = ({ item }: { item: Slide }) => {
    // HERO slide — full-screen image with overlay text
    if (item.type === "hero" || item.type === "ready") {
      return (
        <View style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
          {item.image && (
            <Image
              source={{ uri: item.image }}
              style={{
                position: "absolute",
                width: SCREEN_WIDTH,
                height: SCREEN_HEIGHT,
              }}
              resizeMode="cover"
            />
          )}
          <LinearGradient
            colors={item.gradientColors || ["transparent", "#0F172A"]}
            style={{ position: "absolute", width: "100%", height: "100%" }}
            locations={[0, 0.3, 0.65, 1]}
          />
          <View
            style={{
              flex: 1,
              justifyContent: "flex-end",
              paddingHorizontal: 32,
              paddingBottom: 160,
            }}
          >
            {item.type === "ready" && (
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: "rgba(16, 185, 129, 0.2)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                  borderWidth: 1,
                  borderColor: "rgba(16, 185, 129, 0.3)",
                }}
              >
                <Check color="#10B981" size={36} />
              </View>
            )}
            <Text
              style={{
                fontSize: item.type === "hero" ? 42 : 36,
                fontWeight: "800",
                color: "#FFFFFF",
                marginBottom: 12,
                lineHeight: item.type === "hero" ? 50 : 44,
                letterSpacing: -0.5,
              }}
            >
              {item.title}
            </Text>
            <Text
              style={{
                fontSize: 17,
                color: "rgba(255,255,255,0.8)",
                lineHeight: 26,
              }}
            >
              {item.subtitle}
            </Text>
          </View>
        </View>
      );
    }

    // FEATURE slides — icon + text centered
    if (item.type === "feature") {
      return (
        <View style={{ width: SCREEN_WIDTH }}>
          <LinearGradient
            colors={item.gradientColors || ["#0F172A", "#1E293B", "#0F172A"]}
            style={{ position: "absolute", width: "100%", height: "100%" }}
          />
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 40,
              paddingBottom: 80,
            }}
          >
            <View
              style={{
                width: 100,
                height: 100,
                borderRadius: 32,
                backgroundColor: "rgba(255,255,255,0.05)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 32,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.1)",
              }}
            >
              {item.icon}
            </View>
            <Text
              style={{
                fontSize: 32,
                fontWeight: "800",
                color: "#FFFFFF",
                textAlign: "center",
                marginBottom: 16,
                letterSpacing: -0.3,
              }}
            >
              {item.title}
            </Text>
            <Text
              style={{
                fontSize: 17,
                color: "#94A3B8",
                textAlign: "center",
                lineHeight: 26,
              }}
            >
              {item.subtitle}
            </Text>
          </View>
        </View>
      );
    }

    // FORM slides — name, location, preferences
    return (
      <View style={{ width: SCREEN_WIDTH }}>
        <LinearGradient
          colors={item.gradientColors || ["#0F172A", "#1E293B", "#0F172A"]}
          style={{ position: "absolute", width: "100%", height: "100%" }}
        />
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 28,
            paddingTop: 80,
            paddingBottom: 160,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Section header */}
          <View style={{ marginBottom: 32 }}>
            <Text
              style={{
                fontSize: 30,
                fontWeight: "800",
                color: "#FFFFFF",
                marginBottom: 8,
                letterSpacing: -0.3,
              }}
            >
              {item.title}
            </Text>
            <Text style={{ fontSize: 16, color: "#94A3B8", lineHeight: 24 }}>
              {item.subtitle}
            </Text>
          </View>

          {/* NAME FORM */}
          {item.type === "form_name" && (
            <View style={{ gap: 20 }}>
              <View>
                <Text style={{ color: "#CBD5E1", marginBottom: 8, fontSize: 14, fontWeight: "600" }}>
                  First Name
                </Text>
                <TextInput
                  style={{
                    backgroundColor: "rgba(15, 23, 42, 0.6)",
                    borderRadius: 14,
                    padding: 16,
                    color: "#FFFFFF",
                    fontSize: 16,
                    borderWidth: 1,
                    borderColor: "rgba(71, 85, 105, 0.5)",
                  }}
                  placeholder="Enter your first name"
                  placeholderTextColor="#64748B"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
              </View>

              <View>
                <Text style={{ color: "#CBD5E1", marginBottom: 8, fontSize: 14, fontWeight: "600" }}>
                  Last Name
                </Text>
                <TextInput
                  style={{
                    backgroundColor: "rgba(15, 23, 42, 0.6)",
                    borderRadius: 14,
                    padding: 16,
                    color: "#FFFFFF",
                    fontSize: 16,
                    borderWidth: 1,
                    borderColor: "rgba(71, 85, 105, 0.5)",
                  }}
                  placeholder="Enter your last name"
                  placeholderTextColor="#64748B"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>

              <View>
                <Text style={{ color: "#CBD5E1", marginBottom: 8, fontSize: 14, fontWeight: "600" }}>
                  Bio{" "}
                  <Text style={{ color: "#64748B", fontWeight: "400" }}>(optional)</Text>
                </Text>
                <TextInput
                  style={{
                    backgroundColor: "rgba(15, 23, 42, 0.6)",
                    borderRadius: 14,
                    padding: 16,
                    color: "#FFFFFF",
                    fontSize: 16,
                    height: 100,
                    borderWidth: 1,
                    borderColor: "rgba(71, 85, 105, 0.5)",
                    textAlignVertical: "top",
                  }}
                  placeholder="Tell us about yourself — pace, goals, favorite trails..."
                  placeholderTextColor="#64748B"
                  value={bio}
                  onChangeText={setBio}
                  multiline
                />
              </View>
            </View>
          )}

          {/* LOCATION FORM */}
          {item.type === "form_location" && (
            <View style={{ gap: 16 }}>
              <View>
                <Text style={{ color: "#CBD5E1", marginBottom: 8, fontSize: 14, fontWeight: "600" }}>
                  City & State
                </Text>
                <TextInput
                  style={{
                    backgroundColor: "rgba(15, 23, 42, 0.6)",
                    borderRadius: 14,
                    padding: 16,
                    color: "#FFFFFF",
                    fontSize: 16,
                    borderWidth: 1,
                    borderColor: "rgba(71, 85, 105, 0.5)",
                  }}
                  placeholder="e.g., Logan, UT"
                  placeholderTextColor="#64748B"
                  value={locationName}
                  onChangeText={setLocationName}
                  autoCapitalize="words"
                />
              </View>

              <TouchableOpacity
                style={{
                  backgroundColor: "rgba(16, 185, 129, 0.1)",
                  borderRadius: 14,
                  padding: 16,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: "rgba(16, 185, 129, 0.3)",
                }}
                onPress={() => setShowLocationModal(true)}
              >
                <MapPin color="#10B981" size={18} />
                <Text style={{ color: "#10B981", fontWeight: "700", fontSize: 15 }}>
                  Use GPS or Search
                </Text>
              </TouchableOpacity>

              {locationLat !== null && locationLon !== null && (
                <View
                  style={{
                    backgroundColor: "rgba(16, 185, 129, 0.1)",
                    borderRadius: 12,
                    padding: 12,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Check color="#10B981" size={16} />
                  <Text style={{ color: "#10B981", fontSize: 14, fontWeight: "600" }}>
                    Location set — {locationName || "GPS coordinates saved"}
                  </Text>
                </View>
              )}

              <Text style={{ color: "#64748B", fontSize: 13, marginTop: 4, lineHeight: 20 }}>
                We use this to show you races nearby. You can always change your search radius later.
              </Text>
            </View>
          )}

          {/* PREFERENCES FORM */}
          {item.type === "form_preferences" && (
            <View style={{ gap: 28 }}>
              {/* Distance preference */}
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Route color="#10B981" size={18} />
                  <Text style={{ color: "#E2E8F0", fontSize: 16, fontWeight: "700" }}>
                    Preferred Distance
                  </Text>
                </View>
                <ChipSelector
                  options={DISTANCE_OPTIONS}
                  selected={prefDistance}
                  onSelect={setPrefDistance}
                />
              </View>

              {/* Difficulty preference */}
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Mountain color="#10B981" size={18} />
                  <Text style={{ color: "#E2E8F0", fontSize: 16, fontWeight: "700" }}>
                    Difficulty Level
                  </Text>
                </View>
                <ChipSelector
                  options={DIFFICULTY_OPTIONS}
                  selected={prefDifficulty}
                  onSelect={setPrefDifficulty}
                />
              </View>

              {/* Search radius preference */}
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <Compass color="#10B981" size={18} />
                  <Text style={{ color: "#E2E8F0", fontSize: 16, fontWeight: "700" }}>
                    Search Radius
                  </Text>
                </View>
                <ChipSelector
                  options={RADIUS_OPTIONS}
                  selected={prefRadius}
                  onSelect={(val) => setPrefRadius(val ?? 0)}
                />
              </View>

              <Text style={{ color: "#64748B", fontSize: 13, textAlign: "center", lineHeight: 20 }}>
                These are optional — you can always adjust filters in the app.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  const currentSlide = slides[currentIndex];
  const isLastSlide = currentIndex === slides.length - 1;
  const isIntroSlide = currentSlide?.type === "hero" || currentSlide?.type === "feature";
  const showSkip = currentIndex < firstFormIndex;

  // CTA button text
  const getButtonText = () => {
    if (isLastSlide) return isSaving ? "Setting up..." : "Let's Go!";
    if (currentSlide?.type === "form_preferences") return "Almost done →";
    if (currentSlide?.type === "form_name") return "Next";
    if (currentSlide?.type === "form_location") return "Next";
    return "";
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#0F172A" }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
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
          scrollEnabled={false}
        />
      </KeyboardAvoidingView>

      {/* Bottom controls overlay */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: Platform.OS === "ios" ? 50 : 32,
          paddingHorizontal: 24,
        }}
      >
        {/* Progress bar */}
        <View
          style={{
            height: 4,
            backgroundColor: "rgba(255,255,255,0.1)",
            borderRadius: 2,
            marginBottom: 24,
            overflow: "hidden",
          }}
        >
          <Animated.View
            style={{
              height: "100%",
              backgroundColor: "#10B981",
              borderRadius: 2,
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            }}
          />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {/* Skip button (only on intro slides) */}
          {showSkip ? (
            <TouchableOpacity onPress={handleSkip} style={{ padding: 8 }}>
              <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 16, fontWeight: "600" }}>
                Skip
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 50 }} />
          )}

          {/* Main CTA */}
          {isIntroSlide && !isLastSlide ? (
            // Circle arrow for intro slides
            <TouchableOpacity
              onPress={handleNext}
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: "#10B981",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#10B981",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 6,
              }}
              activeOpacity={0.8}
            >
              <ArrowRight color="white" size={26} />
            </TouchableOpacity>
          ) : (
            // Full-width button for form & ready slides
            <TouchableOpacity
              onPress={handleNext}
              disabled={isSaving}
              style={{
                flex: 1,
                marginLeft: showSkip ? 16 : 0,
                backgroundColor: "#10B981",
                borderRadius: 16,
                paddingVertical: 18,
                alignItems: "center",
                shadowColor: "#10B981",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 6,
              }}
              activeOpacity={0.8}
            >
              {isLastSlide && !isSaving ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "800" }}>
                    {getButtonText()}
                  </Text>
                  <Compass color="#FFFFFF" size={20} />
                </View>
              ) : (
                <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "700" }}>
                  {getButtonText()}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* Spacer for symmetry on intro slides */}
          {isIntroSlide && !isLastSlide && <View style={{ width: 50 }} />}
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
