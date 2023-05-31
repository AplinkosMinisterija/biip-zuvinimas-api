'use strict';

import moleculer from 'moleculer';
import { Method, Service } from 'moleculer-decorators';
import PlantUML from 'moleculer-plantuml';

@Service({
  name: 'uml',
  mixins: [PlantUML],
  settings: {
    plantumlServer:
      process.env.PLANTUML_SERVER || '//www.plantuml.com/',
  },
})
export default class UmlService extends moleculer.Service {
  @Method
  shouldIncludeService(service: any) {
    if (service?.settings?.fields) {
      return true;
    }

    if (service?.settings?.plantuml) {
      return true;
    }

    return false;
  }
}
