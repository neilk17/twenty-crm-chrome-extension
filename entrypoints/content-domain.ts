import { getNormalizedDomain } from '../lib/domain-extractor';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main(ctx) {
    console.log('Twenty CRM domain content script loaded on:', window.location.href);

    browser.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
      if (message.type === 'GET_DOMAIN_FROM_PAGE') {
        const url = window.location.href;
        const domain = getNormalizedDomain(url);
        
        if (domain) {
          sendResponse({ success: true, data: { domain, url } });
        } else {
          sendResponse({ success: false, error: 'Could not extract domain from URL' });
        }
        return true;
      }
    });
  },
});
