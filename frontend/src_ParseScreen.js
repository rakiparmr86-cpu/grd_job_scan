import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { parseFile, exportWordDoc } from './src_api';
import { shareWordFile } from './src_share';

const BRAND = '#2C2E3E';
const ORANGE = '#F58220';

export default function ParseScreen() {
  const [language, setLanguage] = useState('eng');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const pickAndParse = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'text/*',
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/*',
        ],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      setBusy(true);
      setResult(null);
      const file = picked.assets[0];
      const data = await parseFile(file, language);
      setResult(data);
    } catch (error) {
      Alert.alert('Parse failed', error.message || 'Could not parse this file.');
    } finally {
      setBusy(false);
    }
  };

  const exportWord = async () => {
    if (!result?.text.trim()) return;
    setBusy(true);
    try {
      const title = result.filename.replace(/\.[^.]+$/, '') || 'GRD Job Scan';
      const data = await exportWordDoc(title, [{ scan_id: 'parsed', text: result.text }]);
      await shareWordFile(data);
    } catch (error) {
      Alert.alert('Export failed', error.message || 'Could not export Word document.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Upload & parse a file</Text>
        <Text style={styles.help}>
          Send a text, Word (.docx), PDF or image file to the API and get its text back.
        </Text>

        <Text style={styles.label}>OCR language (images only)</Text>
        <View style={styles.langRow}>
          {[
            ['eng', 'English'],
            ['eng+hin', 'English + Hindi'],
          ].map(([value, label]) => (
            <Pressable
              key={value}
              style={[styles.chip, language === value && styles.chipActive]}
              onPress={() => setLanguage(value)}
            >
              <Text style={[styles.chipText, language === value && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={pickAndParse}
          disabled={busy}
          style={({ pressed }) => [styles.button, busy && { opacity: 0.45 }, pressed && { opacity: 0.82 }]}
        >
          <Text style={styles.buttonText}>Choose file & parse</Text>
        </Pressable>

        {busy && (
          <View style={styles.processing}>
            <ActivityIndicator />
            <Text style={styles.help}>Uploading and parsing…</Text>
          </View>
        )}
      </View>

      {result && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{result.filename}</Text>
          <Text style={styles.help}>
            Type: {result.type} • {result.chars} characters
          </Text>
          <TextInput
            value={result.text}
            onChangeText={(text) => setResult((r) => ({ ...r, text, chars: text.length }))}
            multiline
            textAlignVertical="top"
            style={styles.editor}
            placeholder="No text found in this file."
          />
          <Pressable
            onPress={exportWord}
            disabled={busy || !result.text.trim()}
            style={({ pressed }) => [
              styles.button,
              (busy || !result.text.trim()) && { opacity: 0.45 },
              pressed && { opacity: 0.82 },
            ]}
          >
            <Text style={styles.buttonText}>Create & Share Word (.docx)</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: '#F5F6F8', flexGrow: 1 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14 },
  sectionTitle: { color: BRAND, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  help: { color: '#666B78', lineHeight: 20 },
  label: { marginTop: 14, marginBottom: 7, color: BRAND, fontWeight: '700' },
  langRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: '#D7D9E0',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { color: BRAND, fontWeight: '700' },
  button: {
    marginTop: 16,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '800' },
  processing: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
  editor: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: '#D7D9E0',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    color: '#232633',
  },
});
