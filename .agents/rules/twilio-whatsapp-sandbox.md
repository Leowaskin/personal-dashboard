# Twilio WhatsApp Sandbox Constraints

When building or debugging WhatsApp bots using the Twilio Sandbox, adhere to the following constraints:

1. **REST API Limitation (Error 21654)**: Do not use the Twilio REST API (`twilioClient.messages.create()`) to send free-form text messages in the Sandbox. This will result in a "ContentSid Required" error because Twilio strictly enforces message templates in the sandbox environment for the REST API.
2. **Synchronous TwiML Only**: To send free-form text, you MUST reply synchronously to the incoming HTTP webhook using TwiML (`<Response><Message>...</Message></Response>`).
3. **15-Second Timeout**: Because you must reply synchronously via TwiML, all backend processing (including LLM generation, API calls, etc.) must complete within Twilio's strict 15-second webhook timeout. Avoid architectural patterns that attempt to respond asynchronously with free-form text.
