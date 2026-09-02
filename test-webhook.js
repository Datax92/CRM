const crypto = require('crypto');

const secret = 'test-secret';
const payload = {
  object: 'page',
  entry: [
    {
      changes: Array.from({ length: 100 }).map((_, i) => ({
        field: 'leadgen',
        value: {
          leadgen_id: `test_lead_${Date.now()}_${i}`,
          ad_id: 'test_ad_123',
          form_id: 'test_form_123',
          page_id: 'test_page_123'
        }
      }))
    }
  ]
};

const rawBody = JSON.stringify(payload);
const signature = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

fetch('http://localhost:3000/api/webhooks/meta', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': `sha256=${signature}`
  },
  body: rawBody
})
.then(async (res) => {
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Body: ${text}`);
})
.catch(console.error);
