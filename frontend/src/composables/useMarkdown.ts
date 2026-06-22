/**
 * Markdown rendering with syntax highlighting
 */
import { ref } from 'vue';

export function useMarkdown() {
  const renderedHtml = ref('');
  const loading = ref(false);

  async function renderMarkdown(text: string): Promise<string> {
    loading.value = true;
    try {
      const [{ marked }, hljs] = await Promise.all([
        import('marked'),
        import('highlight.js'),
      ]);

      marked.setOptions({
        // @ts-expect-error - highlight.js integration
        highlight: function (code: string, lang: string) {
          if (lang && hljs.default.getLanguage(lang)) {
            return hljs.default.highlight(code, { language: lang }).value;
          }
          return hljs.default.highlightAuto(code).value;
        },
      });

      const html = marked.parse(text) as string;
      renderedHtml.value = html;
      return html;
    } finally {
      loading.value = false;
    }
  }

  return { renderedHtml, loading, renderMarkdown };
}
