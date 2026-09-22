import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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
  exportWordDoc,
  setAuthToken,
  setUnauthorizedHandler,
} from './src_api';
import { shareWordFile } from './src_share';
import LoginScreen from './src_LoginScreen';
import ParseScreen from './src_ParseScreen';

const BRAND = '#2C2E3E';
const ORANGE = '#F58220';

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
  const [title, setTitle] = useState('GRD Job Scan');
  const [language, setLanguage] = useState('eng');

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
      await uploadScan(result.assets[0]);
    } catch (error) {
      Alert.alert('Image error', error.message || 'Could not open the image.');
    }
  };

  const uploadScan = async (asset) => {
    setBusy(true);
    try {
      const data = await scanDocument(asset, language);

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

  const exportWord = async () => {
    if (!pages.length) return;

    setBusy(true);
    try {
      const data = await exportWordDoc(
        title,
        pages.map((page) => ({ scan_id: page.id, text: page.text }))
      );

      await shareWordFile(data);
    } catch (error) {
      Alert.alert('Export failed', error.message || 'Could not export Word document.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>GRD</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.appName}>GRD Job Scan</Text>
              <Text style={styles.subTitle}>Scan → Enhance → OCR → Edit → Word</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1. Add document pages</Text>
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

            <Text style={styles.label}>OCR language</Text>
            <View style={styles.langRow}>
              <Pressable
                style={[styles.langChip, language === 'eng' && styles.langChipActive]}
                onPress={() => setLanguage('eng')}
              >
                <Text style={[styles.langText, language === 'eng' && styles.langTextActive]}>English</Text>
              </Pressable>
              <Pressable
                style={[styles.langChip, language === 'eng+hin' && styles.langChipActive]}
                onPress={() => setLanguage('eng+hin')}
              >
                <Text style={[styles.langText, language === 'eng+hin' && styles.langTextActive]}>English + Hindi</Text>
              </Pressable>
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
            <Text style={styles.sectionTitle}>3. Export to Word</Text>
            <Text style={styles.label}>Document title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={styles.titleInput}
              placeholder="Document title"
            />
            <ActionButton title="Create & Share Word (.docx)" onPress={exportWord} disabled={!canExport} />
          </View>

          <Text style={styles.footer}>
            MVP • Keep the Python API and phone on the same Wi-Fi network during local testing.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND },
  flex: { flex: 1 },
  container: { padding: 16, backgroundColor: '#F5F6F8', flexGrow: 1 },
  header: {
    backgroundColor: BRAND,
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
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  appName: { color: '#fff', fontSize: 24, fontWeight: '800' },
  subTitle: { color: '#D7D9E0', marginTop: 3, fontSize: 12 },
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
  buttonPrimary: { backgroundColor: ORANGE },
  buttonSecondary: { backgroundColor: '#ECEEF3', borderWidth: 1, borderColor: '#DADDE5' },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  label: { marginTop: 12, marginBottom: 7, color: BRAND, fontWeight: '700' },
  langRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  langChip: {
    borderWidth: 1,
    borderColor: '#D7D9E0',
    backgroundColor: '#fff',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  langChipActive: { backgroundColor: BRAND, borderColor: BRAND },
  langText: { color: BRAND, fontWeight: '700' },
  langTextActive: { color: '#fff' },
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
      <StatusBar barStyle="light-content" backgroundColor={BRAND} />
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
  bar: { flexDirection: 'row', backgroundColor: BRAND, paddingHorizontal: 8, paddingTop: 6 },
  tab: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: ORANGE },
  tabText: { color: '#B9BCC8', fontWeight: '700' },
  tabTextActive: { color: '#fff' },
});
