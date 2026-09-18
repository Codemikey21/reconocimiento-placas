import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Animated,
  Easing,
  FlatList,
  Modal,
  SafeAreaView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL as DEFAULT_API_URL } from "./config";

// ---------------------------------------------------------------------------
// Tema (basado en el diseño generado en Stitch: claro, minimalista, acento
// azul índigo, tarjetas blancas con sombra suave)
// ---------------------------------------------------------------------------
const COLORS = {
  bg: "#F9F9FB",
  surface: "#FFFFFF",
  surfaceLow: "#F3F3F5",
  surfaceHigh: "#E8E8EA",
  border: "#E2E2E4",
  text: "#1A1C1D",
  textSecondary: "#565E74",
  textMuted: "#94A3B8",
  primary: "#1E3A8A",
  primaryLight: "#DAE2FD",
  success: "#047857",
  successLight: "#ECFDF5",
  danger: "#BA1A1A",
  dangerLight: "#FFDAD6",
  scanLine: "#22D3EE",
};

const STORAGE_KEY = "PLACAS_API_URL";
const SPEECH_LANGUAGE = "es-ES"; // cámbialo a "es-419" o "es-CO" si tu iPhone tiene esa voz instalada
const SCAN_DELAY_MS = 900; // pausa entre cada intento de escaneo automático
const SAME_PLATE_COOLDOWN_MS = 8000; // no repetir en voz la misma placa antes de este tiempo

function speakPlate(plateText) {
  const spaced = plateText.split("").join(" ");
  Speech.stop();
  Speech.speak(`Placa detectada: ${spaced}`, {
    language: SPEECH_LANGUAGE,
    pitch: 1.0,
    rate: 0.95,
  });
}

// Anuncia una o varias placas nuevas en una sola locución (no corta la
// anterior a mitad si llegan varias en el mismo escaneo).
function speakPlates(plateTexts) {
  if (!plateTexts || plateTexts.length === 0) return;
  const spokenParts = plateTexts.map((p) => p.split("").join(" "));
  const intro = plateTexts.length === 1 ? "Placa detectada" : `${plateTexts.length} placas detectadas`;
  Speech.stop();
  Speech.speak(`${intro}. ${spokenParts.join(". Siguiente placa. ")}`, {
    language: SPEECH_LANGUAGE,
    pitch: 1.0,
    rate: 0.95,
  });
}

// ---------------------------------------------------------------------------
// Pantalla de bienvenida (splash / onboarding)
// ---------------------------------------------------------------------------
function SplashScreen({ onFinish }) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 50, useNativeDriver: true }),
    ]).start();
  }, [fade, scale]);

  const features = [
    {
      icon: "flash-outline",
      bg: COLORS.primaryLight,
      color: COLORS.primary,
      title: "Escaneo continuo",
      subtitle: "Captura fluida sin obturador manual",
    },
    {
      icon: "mic-outline",
      bg: COLORS.successLight,
      color: COLORS.success,
      title: "Lectura auditiva",
      subtitle: "Instantánea con voz natural en español",
    },
    {
      icon: "shield-checkmark-outline",
      bg: "#EFF6FF",
      color: "#2563EB",
      title: "Modelo propio",
      subtitle: "YOLO entrenado y desplegado en AWS",
    },
  ];

  return (
    <SafeAreaView style={styles.splashContainer}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <Animated.View
        style={{
          opacity: fade,
          transform: [{ scale }],
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          width: "100%",
        }}
      >
        <View style={styles.splashIconCard}>
          <Ionicons name="car-sport" size={44} color={COLORS.primary} />
        </View>
        <Text style={styles.splashTitle}>Escáner de Placas</Text>
        <Text style={styles.splashSubtitle}>
          Reconocimiento automático y lectura por voz en tiempo real.
        </Text>

        <View style={styles.featureCard}>
          {features.map((f, i) => (
            <View key={i} style={[styles.featureRow, i > 0 && { marginTop: 10 }]}>
              <View style={[styles.featureIcon, { backgroundColor: f.bg }]}>
                <Ionicons name={f.icon} size={18} color={f.color} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureSubtitle}>{f.subtitle}</Text>
              </View>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={{ opacity: fade, width: "100%", paddingHorizontal: 24, paddingBottom: 12 }}>
        <TouchableOpacity style={styles.splashButton} onPress={onFinish} activeOpacity={0.9}>
          <Text style={styles.splashButtonText}>Comenzar</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
        <View style={styles.privacyRow}>
          <Ionicons name="lock-closed-outline" size={12} color={COLORS.textMuted} />
          <Text style={styles.privacyText}>Optimizado para iPhone · Modelo propio en AWS</Text>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Marco guía animado (esquinas claras + línea de escaneo)
// ---------------------------------------------------------------------------
function ScanFrame({ active }) {
  const scanAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: active ? 1400 : 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: active ? 1400 : 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scanAnim, active]);

  const lineTranslate = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 96] });

  return (
    <View style={styles.plateFrame}>
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
      <Animated.View style={[styles.scanLine, { transform: [{ translateY: lineTranslate }] }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fila de historial
// ---------------------------------------------------------------------------
function HistoryRow({ item, index, onSpeak }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 300,
      delay: Math.min(index * 50, 350),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  const confColor = item.confidence >= 0.9 ? COLORS.success : item.confidence >= 0.7 ? "#B45309" : COLORS.textSecondary;

  return (
    <Animated.View
      style={[
        styles.historyRow,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <View style={styles.historyIconWrap}>
        <Ionicons name="car-sport-outline" size={18} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={styles.historyPlate}>{item.plate}</Text>
          <View style={[styles.confBadge, { borderColor: confColor }]}>
            <Text style={[styles.confBadgeText, { color: confColor }]}>{(item.confidence * 100).toFixed(0)}%</Text>
          </View>
        </View>
        <Text style={styles.historyMeta}>{item.time}</Text>
      </View>
      <TouchableOpacity onPress={() => onSpeak(item.plate)} style={styles.historySpeak}>
        <Ionicons name="volume-high-outline" size={18} color={COLORS.textSecondary} />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Barra de confianza animada
// ---------------------------------------------------------------------------
function ConfidenceBar({ value }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [anim, value]);

  return (
    <View style={styles.confidenceTrack}>
      <Animated.View
        style={[styles.confidenceFill, { width: anim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// App principal
// ---------------------------------------------------------------------------
export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();

  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [apiUrlDraft, setApiUrlDraft] = useState(DEFAULT_API_URL);
  const [connectionStatus, setConnectionStatus] = useState("idle");

  const cameraRef = useRef(null);
  const scanningRef = useRef(false);
  const apiUrlRef = useRef(DEFAULT_API_URL);
  const lastPlateTimesRef = useRef({}); // { [placa]: timestampUltimoAnuncio }
  const resultTimeoutRef = useRef(null);

  const resultAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved) {
        setApiUrl(saved);
        setApiUrlDraft(saved);
        apiUrlRef.current = saved;
      }
    });
  }, []);

  useEffect(() => {
    apiUrlRef.current = apiUrl;
  }, [apiUrl]);

  const showResultCard = useCallback((autoHideMs) => {
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    resultAnim.setValue(0);
    checkAnim.setValue(0);
    Animated.spring(resultAnim, { toValue: 1, friction: 8, tension: 65, useNativeDriver: true }).start(() => {
      Animated.spring(checkAnim, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }).start();
    });
    if (autoHideMs) {
      resultTimeoutRef.current = setTimeout(() => hideResultCard(), autoHideMs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hideResultCard = useCallback(() => {
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    Animated.timing(resultAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setResult(null));
  }, [resultAnim]);

  // -- Bucle de escaneo continuo --------------------------------------------
  const scanOnce = useCallback(async () => {
    if (!cameraRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: false, skipProcessing: true });

      // Usamos expo-file-system para subir el archivo en vez de armar un
      // FormData a mano: en versiones recientes de Expo/React Native el
      // FormData manual con { uri, name, type } falla con
      // "Unsupported FormDataPart implementation". uploadAsync hace el
      // multipart/form-data de forma nativa, sin ese problema.
      const uploadResult = await FileSystem.uploadAsync(`${apiUrlRef.current}/recognize`, photo.uri, {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "file",
        mimeType: "image/jpeg",
      });

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Servidor respondió ${uploadResult.status}`);
      }
      const data = JSON.parse(uploadResult.body);

      if (data.success && Array.isArray(data.plates) && data.plates.length > 0) {
        const now = Date.now();
        // Solo anunciamos/guardamos las placas que no se hayan leído hace
        // poco (cada placa tiene su propio cooldown independiente, así que
        // si hay dos carros en el cuadro, ambas se anuncian).
        const newPlates = data.plates.filter((p) => {
          const lastTime = lastPlateTimesRef.current[p.plate_text] || 0;
          return now - lastTime > SAME_PLATE_COOLDOWN_MS;
        });

        if (newPlates.length > 0) {
          newPlates.forEach((p) => {
            lastPlateTimesRef.current[p.plate_text] = now;
          });

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speakPlates(newPlates.map((p) => p.plate_text));

          const nowLabel = new Date().toLocaleTimeString();
          const entries = newPlates.map((p, i) => ({
            id: `${now}-${i}`,
            plate: p.plate_text,
            confidence: p.confidence,
            time: nowLabel,
          }));
          setHistory((prev) => [...entries, ...prev].slice(0, 30));
          setResult({ ok: true, plates: data.plates, processing_time_ms: data.processing_time_ms });
          showResultCard(3500);
        }
      }
      // Si no hay éxito, no mostramos nada: seguimos escaneando en silencio.
    } catch (err) {
      // Un error de red/servidor sí detiene el escaneo automático, para no
      // repetir el mismo error muchas veces por segundo.
      scanningRef.current = false;
      setScanning(false);
      setResult({ ok: false, message: `Error de conexión: ${err.message}` });
      showResultCard(null);
    } finally {
      setBusy(false);
    }
  }, [showResultCard]);

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      while (scanningRef.current && !cancelled) {
        await scanOnce();
        if (!scanningRef.current || cancelled) break;
        await new Promise((resolve) => setTimeout(resolve, SCAN_DELAY_MS));
      }
    }

    if (scanning) {
      scanningRef.current = true;
      loop();
    } else {
      scanningRef.current = false;
    }

    return () => {
      cancelled = true;
    };
  }, [scanning, scanOnce]);

  // Iniciar el escaneo automáticamente apenas se concede el permiso de cámara.
  useEffect(() => {
    if (permission?.granted && !showSplash) {
      setScanning(true);
    }
  }, [permission?.granted, showSplash]);

  async function handleSaveSettings() {
    const trimmed = apiUrlDraft.trim().replace(/\/$/, "");
    setApiUrl(trimmed);
    apiUrlRef.current = trimmed;
    await AsyncStorage.setItem(STORAGE_KEY, trimmed);
    setConnectionStatus("idle");
    setSettingsVisible(false);
  }

  async function handleTestConnection() {
    setConnectionStatus("checking");
    try {
      const trimmed = apiUrlDraft.trim().replace(/\/$/, "");
      const res = await fetch(`${trimmed}/health`, { method: "GET" });
      setConnectionStatus(res.ok ? "ok" : "fail");
    } catch (e) {
      setConnectionStatus("fail");
    }
  }

  function handleRetry() {
    hideResultCard();
    setScanning(true);
  }

  function handleClearHistory() {
    setHistory([]);
  }

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (!permission) {
    return <View style={[styles.center, { backgroundColor: COLORS.bg }]} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: COLORS.bg }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.splashIconCard}>
          <Ionicons name="camera-outline" size={40} color={COLORS.primary} />
        </View>
        <Text style={styles.permissionText}>Necesitamos acceso a tu cámara para escanear placas</Text>
        <TouchableOpacity style={styles.splashButton} onPress={requestPermission}>
          <Text style={styles.splashButtonText}>Dar permiso</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchOn}
        pictureSize="1280x720"
      />
      <View style={styles.vignetteTop} pointerEvents="none" />
      <View style={styles.vignetteBottom} pointerEvents="none" />

      <SafeAreaView style={styles.headerSafe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Escáner de Placas</Text>
          <View style={{ flexDirection: "row" }}>
            <TouchableOpacity
              style={[styles.iconButton, { marginRight: 10 }]}
              onPress={() => {
                setApiUrlDraft(apiUrl);
                setConnectionStatus("idle");
                setSettingsVisible(true);
              }}
            >
              <Ionicons name="settings-outline" size={19} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => setHistoryVisible(true)}>
              <Ionicons name="time-outline" size={19} color="#fff" />
              {history.length > 0 && (
                <View style={styles.historyBadge}>
                  <Text style={styles.historyBadgeText}>{history.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statusPillWrap}>
          <View style={styles.statusPill}>
            <View style={[styles.statusDot, { backgroundColor: scanning ? COLORS.success : COLORS.textMuted }]} />
            <Text style={styles.statusPillText}>
              {scanning ? (busy ? "Analizando..." : "Escaneando en vivo") : "En pausa"}
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.frameOverlay} pointerEvents="none">
        <ScanFrame active={scanning} />
        <View style={styles.hintPill}>
          <Text style={styles.hintText}>Alinea la placa dentro del marco</Text>
        </View>
      </View>

      <SafeAreaView style={styles.footerSafe}>
        <View style={styles.footerRow}>
          <TouchableOpacity style={styles.roundGhostButton} onPress={() => setTorchOn((t) => !t)} activeOpacity={0.85}>
            <Ionicons name={torchOn ? "flash" : "flash-outline"} size={20} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.pauseButton} onPress={() => setScanning((s) => !s)} activeOpacity={0.9}>
            <Ionicons name={scanning ? "pause" : "play"} size={18} color={COLORS.text} />
            <Text style={styles.pauseButtonText}>{scanning ? "Pausar escaneo" : "Reanudar"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.roundGhostButton} activeOpacity={0.85}>
            <Ionicons name="scan-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomNav}>
          <View style={styles.navItemActive}>
            <Ionicons name="scan" size={22} color={COLORS.primary} />
            <Text style={styles.navLabelActive}>Escanear</Text>
          </View>
          <TouchableOpacity style={styles.navItem} onPress={() => setHistoryVisible(true)}>
            <Ionicons name="time-outline" size={22} color={COLORS.textSecondary} />
            <Text style={styles.navLabel}>Historial</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => {
              setApiUrlDraft(apiUrl);
              setConnectionStatus("idle");
              setSettingsVisible(true);
            }}
          >
            <Ionicons name="settings-outline" size={22} color={COLORS.textSecondary} />
            <Text style={styles.navLabel}>Ajustes</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Tarjeta de resultado (bottom sheet claro) */}
      {result && (
        <Animated.View
          style={[
            styles.resultSheet,
            {
              transform: [{ translateY: resultAnim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
            },
          ]}
        >
          <View style={styles.sheetHandle} />
          {result.ok ? (
            <>
              <View style={styles.sheetHeaderRow}>
                <View style={styles.speakingPill}>
                  <Animated.View style={{ transform: [{ scale: checkAnim }] }}>
                    <Ionicons name="volume-high" size={16} color={COLORS.primary} />
                  </Animated.View>
                  <Text style={styles.speakingPillText}>
                    {result.plates.length > 1 ? `${result.plates.length} placas detectadas` : "Leyendo en voz alta..."}
                  </Text>
                </View>
                <TouchableOpacity style={styles.sheetCloseButton} onPress={hideResultCard}>
                  <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              {result.plates.slice(0, 3).map((p, idx) => (
                <View key={`${p.plate_text}-${idx}`} style={[styles.plateCard, idx > 0 && { marginTop: 10 }]}>
                  <Text style={styles.plateText}>{p.plate_text}</Text>
                  <View style={{ width: "100%", marginTop: 10, paddingHorizontal: 4 }}>
                    <ConfidenceBar value={p.confidence} />
                    <Text style={styles.plateSubMeta}>
                      {(p.confidence * 100).toFixed(1)}% · {p.method === "yolo" ? "Modelo propio" : p.method}
                    </Text>
                  </View>
                </View>
              ))}

              <View style={styles.metaRow}>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipLabel}>Tiempo total</Text>
                  <Text style={styles.metaChipValue}>{result.processing_time_ms} ms</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={styles.sheetHeaderRow}>
                <Text style={styles.errorTitle}>No se pudo conectar</Text>
                <TouchableOpacity style={styles.sheetCloseButton} onPress={hideResultCard}>
                  <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.errorText}>{result.message}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.retryButtonText}>Reintentar</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      )}

      {/* Historial */}
      <Modal visible={historyVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Historial de escaneos</Text>
              <TouchableOpacity onPress={() => setHistoryVisible(false)}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={history}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={styles.emptyHistory}>Todavía no has escaneado ninguna placa.</Text>}
              renderItem={({ item, index }) => <HistoryRow item={item} index={index} onSpeak={speakPlate} />}
              contentContainerStyle={{ paddingBottom: 12 }}
            />
            {history.length > 0 && (
              <TouchableOpacity style={styles.clearHistoryButton} onPress={handleClearHistory}>
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                <Text style={styles.clearHistoryText}>Limpiar historial</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Configuración */}
      <Modal visible={settingsVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ajustes y servidor</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.settingsSectionLabel}>URL DEL SERVIDOR API</Text>
            <TextInput
              style={styles.settingsInput}
              value={apiUrlDraft}
              onChangeText={setApiUrlDraft}
              placeholder="http://192.168.1.15:8000"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <TouchableOpacity style={styles.testButton} onPress={handleTestConnection}>
              <Ionicons
                name={
                  connectionStatus === "ok"
                    ? "checkmark-circle"
                    : connectionStatus === "fail"
                    ? "close-circle"
                    : "swap-horizontal-outline"
                }
                size={17}
                color={connectionStatus === "ok" ? COLORS.success : connectionStatus === "fail" ? COLORS.danger : COLORS.primary}
              />
              <Text style={styles.testButtonText}>
                {connectionStatus === "checking"
                  ? "Probando..."
                  : connectionStatus === "ok"
                  ? "Conexión exitosa"
                  : connectionStatus === "fail"
                  ? "No se pudo conectar"
                  : "Probar conexión"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.saveButton} onPress={handleSaveSettings}>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={styles.saveButtonText}>Guardar cambios</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.text },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },

  // Splash / onboarding
  splashContainer: { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", paddingHorizontal: 24 },
  splashIconCard: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 22,
    shadowColor: "#1E3A8A",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  splashTitle: { color: "#0F172A", fontSize: 28, fontWeight: "800", marginBottom: 10, letterSpacing: -0.4 },
  splashSubtitle: {
    color: "#64748B",
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 20,
    lineHeight: 21,
    marginBottom: 28,
    maxWidth: 280,
  },
  featureCard: {
    width: "100%",
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 14,
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 10,
  },
  featureIcon: { width: 34, height: 34, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  featureTitle: { color: "#0F172A", fontSize: 13.5, fontWeight: "700" },
  featureSubtitle: { color: "#64748B", fontSize: 11.5, marginTop: 2 },
  splashButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  splashButtonText: { color: "#fff", fontWeight: "700", fontSize: 16, marginRight: 8 },
  privacyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 14 },
  privacyText: { color: COLORS.textMuted, fontSize: 11.5, marginLeft: 5, letterSpacing: 0.2 },

  permissionText: { color: COLORS.text, fontSize: 16, textAlign: "center", marginTop: 16, marginBottom: 24 },

  // Overlays sobre la cámara
  vignetteTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 160,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  vignetteBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: "rgba(0,0,0,0.4)",
  },

  headerSafe: { position: "absolute", top: 0, left: 0, right: 0 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.35)", textShadowRadius: 6 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  historyBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 3,
  },
  historyBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  statusPillWrap: { alignItems: "center", marginTop: 10 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  statusPillText: { color: "#334155", fontSize: 12.5, fontWeight: "600" },

  frameOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" },
  plateFrame: { width: "80%", aspectRatio: 2.4, position: "relative" },
  corner: { position: "absolute", width: 28, height: 28, borderColor: "rgba(255,255,255,0.95)" },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  scanLine: {
    position: "absolute",
    left: 6,
    right: 6,
    height: 2,
    borderRadius: 2,
    backgroundColor: COLORS.scanLine,
    shadowColor: COLORS.scanLine,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  hintPill: {
    marginTop: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  hintText: { color: "#fff", fontSize: 12.5, fontWeight: "500" },

  footerSafe: { position: "absolute", bottom: 0, left: 0, right: 0 },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  roundGhostButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  pauseButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 24,
    shadowColor: "#0F172A",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  pauseButtonText: { color: COLORS.text, fontWeight: "700", fontSize: 14.5, marginLeft: 8 },

  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: COLORS.surface,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 26 : 14,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
  navItemActive: { alignItems: "center" },
  navLabelActive: { color: COLORS.primary, fontSize: 11, fontWeight: "700", marginTop: 3 },
  navItem: { alignItems: "center" },
  navLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 3 },

  // Tarjeta de resultado
  resultSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.surfaceHigh, alignSelf: "center", marginBottom: 14 },
  sheetHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  speakingPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  speakingPillText: { color: COLORS.primary, fontSize: 12.5, fontWeight: "700", marginLeft: 7 },
  sheetCloseButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.surfaceLow,
    justifyContent: "center",
    alignItems: "center",
  },
  plateCard: {
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 16,
  },
  plateText: { color: "#0F172A", fontSize: 30, fontWeight: "800", letterSpacing: 3 },
  plateSubMeta: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 6, textAlign: "center" },
  confidenceRow: { marginBottom: 14 },
  confidenceLabel: { color: "#0F172A", fontSize: 13.5, fontWeight: "700", marginLeft: 6 },
  confidenceTrack: { width: "100%", height: 6, borderRadius: 3, backgroundColor: COLORS.surfaceHigh, overflow: "hidden" },
  confidenceFill: { height: "100%", backgroundColor: COLORS.primary, borderRadius: 3 },
  metaRow: { flexDirection: "row", gap: 10 },
  metaChip: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  metaChipLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600", marginBottom: 2 },
  metaChipValue: { color: "#0F172A", fontSize: 13, fontWeight: "700" },

  errorTitle: { color: "#0F172A", fontSize: 16, fontWeight: "700" },
  errorText: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 16, lineHeight: 20 },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.danger,
    paddingVertical: 13,
    borderRadius: 14,
  },
  retryButtonText: { color: "#fff", marginLeft: 8, fontWeight: "700", fontSize: 14.5 },

  // Modales (historial / ajustes)
  modalOverlay: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: COLORS.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: "80%" },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.surfaceHigh, alignSelf: "center", marginBottom: 14 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { color: "#0F172A", fontSize: 18, fontWeight: "700" },
  emptyHistory: { color: COLORS.textSecondary, textAlign: "center", marginTop: 30 },

  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  historyIconWrap: { width: 36, height: 36, borderRadius: 12, backgroundColor: COLORS.primaryLight, justifyContent: "center", alignItems: "center" },
  historyPlate: { color: "#0F172A", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  confBadge: { marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  confBadgeText: { fontSize: 11, fontWeight: "700" },
  historyMeta: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 3 },
  historySpeak: { width: 32, height: 32, borderRadius: 16, justifyContent: "center", alignItems: "center" },

  clearHistoryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, marginTop: 4 },
  clearHistoryText: { color: COLORS.danger, fontWeight: "700", fontSize: 13.5, marginLeft: 6 },

  settingsSectionLabel: { color: COLORS.textSecondary, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.4, marginBottom: 8 },
  settingsInput: {
    backgroundColor: COLORS.surface,
    color: "#0F172A",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14.5,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  testButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  testButtonText: { color: "#0F172A", marginLeft: 8, fontSize: 14, fontWeight: "600" },
  saveButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.primary,
    paddingVertical: 15,
    borderRadius: 16,
  },
  saveButtonText: { color: "#fff", fontWeight: "800", fontSize: 15, marginLeft: 8 },
});
