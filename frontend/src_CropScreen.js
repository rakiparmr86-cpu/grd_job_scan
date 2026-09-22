import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

const ACCENT = '#5B6472';
const HANDLE = 26;
const MIN_BOX = 60;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// asset: an expo-image-picker asset (needs .uri, .width, .height).
// onDone(croppedAsset) / onSkip(originalAsset) / onCancel().
export default function CropScreen({ asset, onDone, onSkip, onCancel }) {
  const [busy, setBusy] = useState(false);

  const screenWidth = Dimensions.get('window').width;
  const displayWidth = Math.min(screenWidth - 32, 480);
  const aspect = asset.width && asset.height ? asset.width / asset.height : 3 / 4;
  const displayHeight = displayWidth / aspect;

  const [box, setBox] = useState({
    left: displayWidth * 0.06,
    top: displayHeight * 0.06,
    right: displayWidth * 0.94,
    bottom: displayHeight * 0.94,
  });
  const boxRef = useRef(box);
  boxRef.current = box;
  const startBoxRef = useRef(box);

  const makeCornerResponder = (corner) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startBoxRef.current = boxRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const start = startBoxRef.current;
        setBox((prev) => {
          const next = { ...prev };
          if (corner === 'tl') {
            next.left = clamp(start.left + gesture.dx, 0, prev.right - MIN_BOX);
            next.top = clamp(start.top + gesture.dy, 0, prev.bottom - MIN_BOX);
          } else if (corner === 'tr') {
            next.right = clamp(start.right + gesture.dx, prev.left + MIN_BOX, displayWidth);
            next.top = clamp(start.top + gesture.dy, 0, prev.bottom - MIN_BOX);
          } else if (corner === 'bl') {
            next.left = clamp(start.left + gesture.dx, 0, prev.right - MIN_BOX);
            next.bottom = clamp(start.bottom + gesture.dy, prev.top + MIN_BOX, displayHeight);
          } else if (corner === 'br') {
            next.right = clamp(start.right + gesture.dx, prev.left + MIN_BOX, displayWidth);
            next.bottom = clamp(start.bottom + gesture.dy, prev.top + MIN_BOX, displayHeight);
          }
          return next;
        });
      },
    });

  // Recreated only when the display size changes (i.e. once per asset).
  const responders = useMemo(
    () => ({
      tl: makeCornerResponder('tl'),
      tr: makeCornerResponder('tr'),
      bl: makeCornerResponder('bl'),
      br: makeCornerResponder('br'),
    }),
    [displayWidth, displayHeight]
  );

  const confirmCrop = async () => {
    if (!asset.width || !asset.height) {
      onSkip(asset);
      return;
    }
    setBusy(true);
    try {
      const scale = asset.width / displayWidth;
      const originX = Math.round(box.left * scale);
      const originY = Math.round(box.top * scale);
      const width = Math.min(Math.round((box.right - box.left) * scale), asset.width - originX);
      const height = Math.min(Math.round((box.bottom - box.top) * scale), asset.height - originY);

      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ crop: { originX, originY, width, height } }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );

      onDone({
        ...asset,
        uri: result.uri,
        width: result.width,
        height: result.height,
        mimeType: 'image/jpeg',
        fileName: asset.fileName || `cropped-${Date.now()}.jpg`,
        file: undefined, // the cropped output is a new local file, not the original web File
      });
    } catch (error) {
      Alert.alert('Crop failed', error.message || 'Could not crop this image. Using the full photo instead.');
      onSkip(asset);
    } finally {
      setBusy(false);
    }
  };

  const corners = [
    ['tl', box.left, box.top],
    ['tr', box.right, box.top],
    ['bl', box.left, box.bottom],
    ['br', box.right, box.bottom],
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>Adjust the crop</Text>
      <Text style={styles.hint}>Drag the corners to fit the document, then crop.</Text>

      <View style={[styles.imageWrap, { width: displayWidth, height: displayHeight }]}>
        <Image
          source={{ uri: asset.uri }}
          style={{ width: displayWidth, height: displayHeight }}
          resizeMode="contain"
        />
        <View
          pointerEvents="none"
          style={[
            styles.box,
            {
              left: box.left,
              top: box.top,
              width: box.right - box.left,
              height: box.bottom - box.top,
            },
          ]}
        />
        {corners.map(([corner, x, y]) => (
          <View
            key={corner}
            {...responders[corner].panHandlers}
            style={[styles.handle, { left: x - HANDLE / 2, top: y - HANDLE / 2 }]}
          />
        ))}
      </View>

      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel} disabled={busy}>
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => onSkip(asset)} disabled={busy}>
          <Text style={styles.btnGhostText}>Use full photo</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnPrimary]} onPress={confirmCrop} disabled={busy}>
          <Text style={styles.btnPrimaryText}>{busy ? 'Cropping…' : 'Crop & Continue'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000', alignItems: 'center', paddingTop: 24, paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '800' },
  hint: { color: '#B9BCC8', marginTop: 4, marginBottom: 16, textAlign: 'center' },
  imageWrap: { position: 'relative', backgroundColor: '#111' },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#F58220',
    backgroundColor: 'rgba(245,130,32,0.12)',
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: '#F58220',
    borderWidth: 2,
    borderColor: '#fff',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 24, width: '100%', maxWidth: 480 },
  btn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  btnGhost: { backgroundColor: '#22242E' },
  btnGhostText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  btnPrimary: { backgroundColor: ACCENT },
  btnPrimaryText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
});
