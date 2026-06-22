/**
 * QR Code generation using qrcode library
 */
import { ref } from 'vue';

export function useQRCode() {
  const qrDataUrl = ref('');
  const loading = ref(false);

  async function generateQR(text: string): Promise<string> {
    loading.value = true;
    try {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(text, {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      qrDataUrl.value = dataUrl;
      return dataUrl;
    } finally {
      loading.value = false;
    }
  }

  return { qrDataUrl, loading, generateQR };
}
