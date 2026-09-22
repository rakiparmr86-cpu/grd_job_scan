import { Alert, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from './src_config';

const MIME_BY_EXT = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};
const UTI_BY_EXT = {
  docx: 'org.openxmlformats.wordprocessingml.document',
  pdf: 'com.adobe.pdf',
};

// data: response of /api/export ({ filename, format, download_url }).
// Downloads the file to the app cache and opens the share sheet (Word/Adobe, Drive, WhatsApp...).
export async function shareExportedFile(data) {
  const fileUrl = `${API_BASE_URL}${data.download_url}`;
  const localName = data.filename || `job-scan-${Date.now()}.${data.format === 'pdf' ? 'pdf' : 'docx'}`;
  const ext = (localName.split('.').pop() || 'docx').toLowerCase();
  const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';

  if (Platform.OS === 'web') {
    window.open(fileUrl, '_blank');
    return;
  }

  const { File, Paths } = await import('expo-file-system');
  const destination = new File(Paths.cache, localName);
  const downloaded = await File.downloadFileAsync(fileUrl, destination, { idempotent: true });

  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('Export ready', `Saved temporarily at:\n${downloaded.uri}`);
    return;
  }

  await Sharing.shareAsync(downloaded.uri, {
    mimeType,
    dialogTitle: `Share Job Scan ${ext.toUpperCase()} file`,
    UTI: UTI_BY_EXT[ext],
  });
}
