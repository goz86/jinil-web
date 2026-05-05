import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://oppfihohhvhsnjrdsmvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcGZpaG9oaHZoc25qcmRzbXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzU2MDUsImV4cCI6MjA5MzExMTYwNX0.2kPzLY_XKbWiJuDJ7UyiSRYPUyBlxXz5zTR8CG--n_M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ── Helpers ──────────────────────────────────────────────
export const fmt = (n) =>
  Number(n || 0).toLocaleString('ko-KR');

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const orderTotal = (o) =>
  (o.items || []).reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);

// Design tokens (Apple style, match web)
export const C = {
  bg:         '#f5f5f7',
  canvas:     '#ffffff',
  ink:        '#1d1d1f',
  inkMuted:   '#6e6e73',
  inkLight:   '#aeaeb2',
  blue:       '#0066cc',
  blueLight:  '#e8f0fb',
  green:      '#28cd41',
  greenLight: '#f0fdf4',
  amber:      '#ff9500',
  amberLight: '#fff7ed',
  red:        '#ff3b30',
  redLight:   '#fff1f0',
  border:     '#e0e0e0',
  hairline:   'rgba(0,0,0,0.08)',
  darkNav:    '#1d1d1f',
};

// Storage buckets
export const BUCKETS = {
  photos: 'photos',
  invoices: 'invoices',
};

// Helper to upload a file to Supabase Storage
export const uploadFile = async (bucket, path, fileUri) => {
  const isPdf = bucket === BUCKETS.invoices;
  const fileName = path.split('/').pop();
  
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: isPdf ? 'application/pdf' : 'image/jpeg',
  });

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, formData, {
      contentType: isPdf ? 'application/pdf' : 'image/jpeg',
      upsert: true,
    });

  if (error) {
    console.error('Upload error details:', error);
    throw error;
  }
  
  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);
    
  return publicUrl;
};
