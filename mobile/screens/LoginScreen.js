import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Animated,
} from 'react-native';
import { useAuth } from '../lib/auth';
import { C } from '../lib/supabase';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [id,       setId]       = useState('');
  const [pw,       setPw]       = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [errMsg,   setErrMsg]   = useState('');

  // Shake animation for error
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (!id.trim() || !pw.trim()) {
      setErrMsg('아이디와 비밀번호를 입력하세요');
      shake();
      return;
    }
    setLoading(true);
    setErrMsg('');
    try {
      const { error } = await signIn(id, pw);
      if (error) {
        setErrMsg('아이디 또는 비밀번호가 틀립니다');
        shake();
      }
    } catch (e) {
      setErrMsg('로그인 오류: ' + e.message);
      shake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>

        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>🏷</Text>
          </View>
          <Text style={styles.title}>진일 라벨</Text>
          <Text style={styles.subtitle}>주문관리 시스템</Text>
        </View>

        {/* Card */}
        <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>

          {/* ID */}
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>아이디</Text>
            <TextInput
              style={styles.input}
              placeholder="admin 또는 admin1"
              placeholderTextColor={C.inkLight}
              value={id}
              onChangeText={v => { setId(v); setErrMsg(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>비밀번호</Text>
            <View style={styles.pwRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="비밀번호 입력"
                placeholderTextColor={C.inkLight}
                value={pw}
                onChangeText={v => { setPw(v); setErrMsg(''); }}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity onPress={() => setShowPw(p => !p)} style={styles.eyeBtn}>
                <Text style={{ fontSize: 18 }}>{showPw ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Error */}
          {errMsg ? (
            <View style={styles.errBox}>
              <Text style={styles.errText}>⚠ {errMsg}</Text>
            </View>
          ) : null}

          {/* Login button */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && { opacity: 0.65 }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.82}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.loginBtnText}>로그인</Text>
            }
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.footer}>진일 라벨 © 2026</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: C.bg },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 24,
  },

  // Logo
  logoWrap:   { alignItems: 'center', gap: 8 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: '#1d1d1f',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.18,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  logoEmoji:  { fontSize: 34 },
  title:      { fontSize: 24, fontWeight: '700', color: C.ink, letterSpacing: -0.5 },
  subtitle:   { fontSize: 14, color: C.inkMuted, fontWeight: '500' },

  // Card
  card: {
    width: '100%',
    backgroundColor: C.canvas,
    borderRadius: 20,
    padding: 24,
    gap: 16,
    shadowColor: '#000', shadowOpacity: 0.07,
    shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
  },

  // Fields
  fieldWrap:  { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: C.inkMuted, letterSpacing: 0.3 },
  input: {
    backgroundColor: C.bg,
    borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 15, color: C.ink,
  },
  pwRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyeBtn: { padding: 8 },

  // Error
  errBox: {
    backgroundColor: '#fff1f0',
    borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#fecaca',
  },
  errText: { color: C.red, fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // Button
  loginBtn: {
    backgroundColor: '#1d1d1f',
    borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

  // Footer
  footer: { fontSize: 11, color: C.inkLight, marginTop: 4 },
});
