'use strict';

const MUTATION_HEADER = 'x-agentdash-request';
const MUTATION_HEADER_VALUE = '1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function requiresMutationHeader(method) {
  return !SAFE_METHODS.has(String(method || '').toUpperCase());
}

function parseHostname(value) {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
}

function allowedRequestHosts(configuredHost) {
  const host = String(configuredHost || '127.0.0.1').toLowerCase();
  return LOOPBACK_HOSTS.has(host) ? LOOPBACK_HOSTS : new Set([host]);
}

function requestSecurity(options = {}) {
  const allowedHosts = allowedRequestHosts(options.host);
  return function requestSecurityMiddleware(req, res, next) {
    const requestHost = parseHostname(req.get('host'));
    if (!requestHost || !allowedHosts.has(requestHost)) {
      return res.status(403).json({
        error: { code: 'HOST_NOT_ALLOWED', message: 'Request host is not allowed.' },
      });
    }

    if (!requiresMutationHeader(req.method)) return next();
    if (req.get(MUTATION_HEADER) !== MUTATION_HEADER_VALUE) {
      return res.status(403).json({
        error: {
          code: 'MUTATION_HEADER_REQUIRED',
          message: 'State-changing requests require the AgentDash request header.',
        },
      });
    }

    const origin = req.get('origin');
    if (origin) {
      let originHost = null;
      try {
        originHost = new URL(origin).hostname.toLowerCase();
      } catch (_) {}
      if (!originHost || !allowedHosts.has(originHost)) {
        return res.status(403).json({
          error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Request origin is not allowed.' },
        });
      }
    }
    return next();
  };
}

function mutationGuard(req, res, next) {
  if (!requiresMutationHeader(req.method)) return next();
  if (req.get(MUTATION_HEADER) === MUTATION_HEADER_VALUE) return next();

  return res.status(403).json({
    error: {
      code: 'MUTATION_HEADER_REQUIRED',
      message: 'State-changing requests require the AgentDash request header.',
    },
  });
}

module.exports = {
  MUTATION_HEADER,
  MUTATION_HEADER_VALUE,
  allowedRequestHosts,
  mutationGuard,
  parseHostname,
  requestSecurity,
  requiresMutationHeader,
};
