#!/bin/sh
set -eu
printf 'window.__APIVOY_CONFIG__ = ' > /usr/share/nginx/html/config.js
jq -cn \
  --arg agentUrl "${APIVOY_PUBLIC_AGENT_PATH}" \
  --arg agentToken "${APIVOY_AGENT_TOKEN}" \
  --arg collaborationUrl "${APIVOY_PUBLIC_COLLABORATION_PATH}" \
  '{agentUrl:$agentUrl,agentToken:$agentToken,collaborationUrl:$collaborationUrl}' \
  >> /usr/share/nginx/html/config.js
printf ';\n' >> /usr/share/nginx/html/config.js
