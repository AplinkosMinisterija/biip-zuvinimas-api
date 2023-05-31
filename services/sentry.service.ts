// @ts-ignore
import SentryMixin from 'moleculer-sentry';

module.exports = {
  mixins: [SentryMixin],

  settings: {
    /** @type {Object?} Sentry configuration wrapper. */
    sentry: {
      /** @type {String} DSN given by sentry. */
      dsn: process.env.SENTRY_DSN,
      /** @type {String} Name of event fired by "Event" exported in tracing. */
      tracingEventName: '$tracing.spans',
      /** @type {Object} Additional options for `Sentry.init`. */
      options: {
        environment: process.env.NODE_ENV,
      },
      /** @type {String?} Name of the meta containing user infos. */
      userMetaKey: 'authUser',
    },

    options: null,
  },
};
