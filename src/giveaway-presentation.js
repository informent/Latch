'use strict';

const { isIP } = require('node:net');
const ID = /^\d{5,25}$/;
const DESCRIPTION_LIMIT = 1500;
const MEDIA_URL_LIMIT = 1024;

function validMediaUrl(value) {
  if (typeof value !== 'string' || !value.length || value.length > MEDIA_URL_LIMIT || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !value.includes('#')
      && !url.port && !isIP(url.hostname) && url.hostname.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
      && !url.hostname.endsWith('.localhost');
  } catch { return false; }
}

function defaultPresentation(hostId) { return { hostId, description: '', image: null, thumbnail: null }; }
function validPresentation(value) {
  return Boolean(value && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'description,hostId,image,thumbnail'
    && typeof value.hostId === 'string' && ID.test(value.hostId)
    && typeof value.description === 'string' && value.description.length <= DESCRIPTION_LIMIT
    && (value.image === null || validMediaUrl(value.image)) && (value.thumbnail === null || validMediaUrl(value.thumbnail)));
}

module.exports = { defaultPresentation, validPresentation, validMediaUrl, DESCRIPTION_LIMIT, MEDIA_URL_LIMIT };
