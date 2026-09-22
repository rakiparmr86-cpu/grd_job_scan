import { Alert, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from './src_config';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// data: response of /api/export-word ({ filename, download_url }).
// Downloads the .docx to the app cache and opens the share sheet (Word, Drive, WhatsApp...).
export async function shareWordFile(data) {
  const fileUrl = `${API_BASE_URL}${data.download_url}`;
  const localName = data.filename || `grd-job-scan-${Date.now()}.docx`;

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
    mimeType: DOCX_MIME,
    dialogTitle: 'Share GRD Job Scan Word file',
    UTI: 'org.openxmlformats.wordprocessingml.document',
  });
}
