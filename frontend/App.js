import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { API_BASE_URL } from './src_config';
import {
  scanDocument,
  deleteScan,
  exportDocument,
  setAuthToken,
  setUnauthorizedHandler,
} from './src_api';
import { shareExportedFile } from './src_share';
import LoginScreen from './src_LoginScreen';
import ParseScreen from './src_ParseScreen';
import CropScreen from './src_CropScreen';
import FormatPicker from './src_FormatPicker';

const BRAND = '#2C2E3E'; // dark text/accent color, not a background anymore
const ACCENT = '#5B6472';
const PAGE_BG = '#F5F6F8';
const HEADER_BG = '#FFFFFF';
const BORDER = '#E2E4EA';
const MUTED = '#666B78';

function ActionButton({ title, onPress, secondary = false, disabled = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.buttonSecondary : styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && { opacity: 0.82 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: BRAND }]}>{title}</Text>
    </Pressable>
  );
}

function ScanScreen() {
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('Job Scan');
  const [format, setFormat] = useState('word');
  const [pendingAsset, setPendingAsset] = useState(null);

  const canExport = useMemo(() => pages.length > 0 && !busy, [pages, busy]);

  const selectImage = async (source) => {
    try {
      let result;

      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission required', 'Camera permission is required to scan a document.');
          return;
        }

        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsEditing: false,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
          allowsEditing: false,
        });
      }

      if (result.canceled || !result.assets?.[0]) return;
      // Show the crop screen first; uploadScan runs once the user confirms or skips it.
      setPendingAsset(result.assets[0]);
    } catch (error) {
      Alert.alert('Image error', error.message || 'Could not open the image.');
    }
  };

  const uploadScan = async (asset) => {
    setBusy(true);
    try {
      const data = await scanDocument(asset);

      setPages((current) => [
        ...current,
        {
          id: data.scan_id,
          imageUrl: `${API_BASE_URL}${data.image_url}`,
          text: data.text || '',
        },
      ]);
    } catch (error) {
      Alert.alert(
        'Scan failed',
        `${error.message}\n\nCheck that the Python API is running and API_BASE_URL points to your computer's LAN IP.`
      );
    } finally {
      setBusy(false);
    }
  };

  const updateText = (id, text) => {
    setPages((current) =>
      current.map((page) => (page.id === id ? { ...page, text } : page))
    );
  };

  const removePage = async (id) => {
    setPages((current) => current.filter((page) => page.id !== id));
    try {
      await deleteScan(id);
    } catch (_) {
      // UI deletion should still succeed if server cleanup fails.
    }
  };

  const exportDoc = async () => {
    if (!pages.length) return;

    setBusy(true);
    try {
      const data = await exportDocument(
        title,
        pages.map((page) => ({ scan_id: page.id, text: page.text })),
        format
      );

      await shareExportedFile(data);
    } catch (error) {
      Alert.alert('Export failed', error.message || 'Could not export the document.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={HEADER_BG} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {/* <View style={styles.logoBox}>
              <Text style={styles.logoText}>GRD</Text>
            </View> */}
            <View style={styles.flex}>
              <Text style={styles.appName}>Job Scan</Text>
              <Text style={styles.subTitle}>Scan → Enhance → OCR → Edit → Word</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1. Add document pages1</Text>
            <Text style={styles.help}>
              Take a photo or import one. The backend automatically finds the document,
              corrects perspective, improves readability and extracts editable text.
            </Text>

            <View style={styles.row}>
              <View style={styles.half}>
                <ActionButton title="Scan with Camera" onPress={() => selectImage('camera')} disabled={busy} />
              </View>
              <View style={styles.half}>
                <ActionButton title="Import Photo" onPress={() => selectImage('library')} secondary disabled={busy} />
              </View>
            </View>

            {busy && (
              <View style={styles.processing}>
                <ActivityIndicator />
                <Text style={styles.processingText}>Processing document…</Text>
              </View>
            )}
          </View>

          {pages.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>2. Review OCR</Text>
              <Text style={styles.help}>
                Correct names, phone numbers, tables or formatting before Word export.
              </Text>

              {pages.map((page, index) => (
                <View key={page.id} style={styles.pageBox}>
                  <View style={styles.pageHeader}>
                    <Text style={styles.pageTitle}>Page {index + 1}</Text>
                    <Pressable onPress={() => removePage(page.id)}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>

                  <Image source={{ uri: page.imageUrl }} style={styles.preview} resizeMode="contain" />

                  <TextInput
                    value={page.text}
                    onChangeText={(text) => updateText(page.id, text)}
                    multiline
                    textAlignVertical="top"
                    style={styles.editor}
                    placeholder="OCR text will appear here..."
                  />
                </View>
              ))}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>3. Export</Text>
            <Text style={styles.label}>Document title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={styles.titleInput}
              placeholder="Document title"
            />
            <Text style={styles.label}>Format</Text>
            <FormatPicker value={format} onChange={setFormat} />
            <View style={{ marginTop: 12 }}>
              <ActionButton
                title={`Create & Share ${format === 'pdf' ? 'PDF' : 'Word (.docx)'}`}
                onPress={exportDoc}
                disabled={!canExport}
              />
            </View>
          </View>

          <Text style={styles.footer}>
            MVP • Keep the Python API and phone on the same Wi-Fi network during local testing.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={!!pendingAsset}
        animationType="slide"
        onRequestClose={() => setPendingAsset(null)}
      >
        {pendingAsset && (
          <CropScreen
            asset={pendingAsset}
            onCancel={() => setPendingAsset(null)}
            onSkip={(asset) => {
              setPendingAsset(null);
              uploadScan(asset);
            }}
            onDone={(asset) => {
              setPendingAsset(null);
              uploadScan(asset);
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG },
  flex: { flex: 1 },
  container: { padding: 16, backgroundColor: PAGE_BG, flexGrow: 1 },
  header: {
    backgroundColor: HEADER_BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    margin: -16,
    marginBottom: 16,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  appName: { color: BRAND, fontSize: 24, fontWeight: '800' },
  subTitle: { color: MUTED, marginTop: 3, fontSize: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sectionTitle: { color: BRAND, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  help: { color: '#666B78', lineHeight: 20, marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  buttonPrimary: { backgroundColor: ACCENT },
  buttonSecondary: { backgroundColor: '#ECEEF3', borderWidth: 1, borderColor: '#DADDE5' },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  label: { marginTop: 12, marginBottom: 7, color: BRAND, fontWeight: '700' },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
  processingText: { color: '#666B78' },
  pageBox: {
    borderWidth: 1,
    borderColor: '#E2E4EA',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  pageTitle: { fontWeight: '800', color: BRAND },
  removeText: { color: '#B42318', fontWeight: '700' },
  preview: {
    width: '100%',
    height: 230,
    backgroundColor: '#F0F1F4',
    borderRadius: 10,
    marginBottom: 10,
  },
  editor: {
    minHeight: 180,
    borderWidth: 1,
    borderColor: '#D7D9E0',
    borderRadius: 10,
    padding: 12,
    color: '#232633',
    backgroundColor: '#fff',
  },
  titleInput: {
    borderWidth: 1,
    borderColor: '#D7D9E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 46,
    marginBottom: 10,
  },
  footer: { textAlign: 'center', color: '#7A7F8B', fontSize: 12, marginVertical: 12 },
});

const TABS = [
  { key: 'scan', label: 'Scan' },
  { key: 'parse', label: 'Upload & Parse' },
];

export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('scan');

  const logout = () => {
    setAuthToken(null);
    setSession(null);
  };

  // Expired or invalid token: drop back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, []);

  const handleLoggedIn = (data) => {
    setAuthToken(data.token);
    setSession(data);
    setTab('scan');
  };

  if (!session) return <LoginScreen onLoggedIn={handleLoggedIn} />;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={HEADER_BG} />
      <View style={menuStyles.bar}>
        {TABS.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setTab(item.key)}
            style={[menuStyles.tab, tab === item.key && menuStyles.tabActive]}
          >
            <Text style={[menuStyles.tabText, tab === item.key && menuStyles.tabTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() =>
            Alert.alert('Log out', `Signed in as ${session.username}.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log out', style: 'destructive', onPress: logout },
            ])
          }
          style={menuStyles.tab}
        >
          <Text style={menuStyles.tabText}>{session.username} ⏻</Text>
        </Pressable>
      </View>

      {/* Both screens stay mounted so scanned pages survive tab switches. */}
      <View style={[styles.flex, tab !== 'scan' && { display: 'none' }]}>
        <ScanScreen />
      </View>
      <View style={[styles.flex, tab !== 'parse' && { display: 'none' }]}>
        <ParseScreen />
      </View>
    </SafeAreaView>
  );
}

const menuStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: HEADER_BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  tab: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: ACCENT },
  tabText: { color: MUTED, fontWeight: '700' },
  tabTextActive: { color: BRAND },
});
