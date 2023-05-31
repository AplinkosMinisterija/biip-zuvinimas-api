'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { ServerClient } from 'postmark';
import { FishStocking } from './fishStockings.service';

export function emailCanBeSent() {
  return ['production', 'staging'].includes(process.env.NODE_ENV);
}

const sender = 'noreply@biip.lt';

const client = new ServerClient(process.env.POSTMARK_KEY);

@Service({
  name: 'mail',
  mixins: [],
  settings: {},
})
export default class FishAgesService extends moleculer.Service {
  @Action({
    params: {
      emails: 'array',
      fishStocking: 'any',
      update: 'boolean',
    },
  })
  async sendFishStockingUpdateEmail(
    ctx: Context<{
      emails: string[];
      fishStocking: FishStocking;
      update: boolean;
    }>,
  ) {
    if (!emailCanBeSent()) return;

    const data = ctx.params.emails.map((e) => ({
      From: sender,
      To: e,
      TemplateId: 28556650,
      TemplateModel: {
        waterBody: ctx.params.fishStocking.location.name,
        municipality: ctx.params.fishStocking.location.municipality.name,
        title: ctx.params.update
          ? 'Įžuvinimas atnaujintas'
          : 'Įžuvinimas sukurtas',
        typeTitle: ctx.params.update ? 'atnaujintas' : 'sukurtas naujas',
        action_url: `${process.env.ADMIN_HOST}/zuvinimas/zurnalas/${ctx.params.fishStocking.id}`,
      },
    }));

    try {
      return client.sendEmailBatchWithTemplates(data);
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  @Action({
    params: {
      email: 'string',
      fishStocking: 'any',
    },
  })
  async sendFishStockingAssignedEmail(
    ctx: Context<{ email: string; fishStocking: FishStocking }>,
  ) {
    if (!emailCanBeSent()) return;

    const data = {
      From: sender,
      To: ctx.params.email,
      TemplateId: 28611239,
      TemplateModel: {
        waterBody: ctx.params.fishStocking.location.name,
        municipality: ctx.params.fishStocking.location.municipality.name,
        action_url: `${process.env.ADMIN_HOST}/zuvinimas/zurnalas/${ctx.params.fishStocking.id}`,
      },
    };

    return client.sendEmailWithTemplate(data);
  }
}
