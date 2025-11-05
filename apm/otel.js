// Bootstrap OpenTelemetry per tracing/metrics
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');

const serviceName = process.env.OTEL_SERVICE_NAME || 'first-aid-manager';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318';

const traceExporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });
const metricExporter = new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` });

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
  }),
  traceExporter,
  metricExporter,
  instrumentations: [getNodeAutoInstrumentations({
    // Abilita Express, HTTP/HTTPS, FS, etc.
    '@opentelemetry/instrumentation-express': { enabled: true },
    '@opentelemetry/instrumentation-http': { enabled: true }
  })]
});

sdk.start()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('[OTel] SDK avviato');
  })
  .catch((err) => {
    console.error('[OTel] Errore avvio SDK:', err);
  });

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});