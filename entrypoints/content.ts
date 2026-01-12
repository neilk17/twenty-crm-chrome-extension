import { scrapeCurrentPage } from '../lib/linkedin-scraper';

export default defineContentScript({
  matches: ['*://*.linkedin.com/in/*', '*://*.linkedin.com/company/*'],
  runAt: 'document_idle',

  main(ctx) {
    console.log('Twenty CRM content script loaded on:', window.location.href);

    browser.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
      if (message.type === 'GET_PAGE_DATA') {
        const data = scrapeCurrentPage();
        sendResponse({ success: !!data, data });
        return true;
      }
    });
  },
});
