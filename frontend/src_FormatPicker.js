import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const BRAND = '#2C2E3E';

const FORMATS = [
  ['word', 'Word (.docx)'],
  ['pdf', 'PDF'],
];

// value: 'word' | 'pdf'. onChange(value).
export default function FormatPicker({ value, onChange }) {
  return (
    <View style={styles.row}>
      {FORMATS.map(([key, label]) => (
        <Pressable
          key={key}
          style={[styles.chip, value === key && styles.chipActive]}
          onPress={() => onChange(key)}
        >
          <Text style={[styles.text, value === key && styles.textActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderWidth: 1,
    borderColor: '#D7D9E0',
    backgroundColor: '#fff',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  chipActive: { backgroundColor: BRAND, borderColor: BRAND },
  text: { color: BRAND, fontWeight: '700' },
  textActive: { color: '#fff' },
});
