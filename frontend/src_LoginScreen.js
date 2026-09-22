import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { login, register } from './src_api';

const BRAND = '#2C2E3E';
const ORANGE = '#F58220';

export default function LoginScreen({ onLoggedIn }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';
  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      const action = isRegister ? register : login;
      const data = await action(username.trim(), password);
      onLoggedIn(data);
    } catch (error) {
      Alert.alert(
        isRegister ? 'Registration failed' : 'Login failed',
        `${error.message}\n\nIf this says "Network request failed", check that the API is running and API_BASE_URL is correct.`
      );
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
          <View style={styles.logoBox}>
            <Text style={styles.logoText}>GRD</Text>
          </View>
          <Text style={styles.title}>GRD Job Scan</Text>
          <Text style={styles.subtitle}>{isRegister ? 'Create an account' : 'Sign in to continue'}</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              placeholder="username"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
              placeholder={isRegister ? 'At least 8 characters' : 'password'}
              onSubmitEditing={canSubmit ? submit : undefined}
            />

            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={({ pressed }) => [styles.button, !canSubmit && { opacity: 0.45 }, pressed && { opacity: 0.82 }]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{isRegister ? 'Create account' : 'Log in'}</Text>
              )}
            </Pressable>

            <Pressable onPress={() => setMode(isRegister ? 'login' : 'register')} disabled={busy}>
              <Text style={styles.switchText}>
                {isRegister ? 'Already have an account? Log in' : "No account? Register"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND },
  flex: { flex: 1 },
  container: { flexGrow: 1, padding: 20, justifyContent: 'center', alignItems: 'stretch' },
  logoBox: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  subtitle: { color: '#D7D9E0', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18 },
  label: { color: BRAND, fontWeight: '700', marginTop: 8, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D7D9E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  button: {
    marginTop: 18,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '800' },
  switchText: { color: BRAND, fontWeight: '700', textAlign: 'center', marginTop: 16 },
});
