import moleculer, { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';
import { TenantUserRole } from '../services/tenantUsers.service';
import { throwNoRightsError } from '../types';
import {Setting} from "../services/settings.service";

export const validateCanManageTenantUser = (ctx: Context<any, UserAuthMeta>, err: string) => {
  const { profile } = ctx.meta;

  if (
    ctx.meta.authUser?.type === AuthUserRole.USER &&
    ![TenantUserRole.OWNER, TenantUserRole.USER_ADMIN].includes(ctx.meta.user.tenants[profile])
  ) {
    throwNoRightsError(err);
  }
};

export const isTimeBeforeReview = async (ctx: Context<any>, time: Date) => {
  const eventTime = time.getTime();
  if(isNaN(eventTime)) {
    throw new moleculer.Errors.ValidationError('Invalid event time');
  }
  const currentTime = new Date().getTime();
  const timeDiff = eventTime - currentTime;
  const settings: Setting = await ctx.call('settings.getSettings');
  return timeDiff >= (24*60*60*1000) * settings.minTimeTillFishStocking;
}

export const isTimeAfterReview = async (ctx: Context<any>, time: Date) => {
  const eventTime = time.getTime();
  if(isNaN(eventTime)) {
    throw new moleculer.Errors.ValidationError('Invalid event time');
  }
  const currentTime = new Date().getTime();
  const timeDiff = eventTime - currentTime;
  const settings: Setting = await ctx.call('settings.getSettings');
  return timeDiff <= (24*60*60*1000) * settings.maxTimeForRegistration;
}

export const isReviewTime = async (ctx: Context<any>, time: Date) => {
  const eventTime = time.getTime();
  if(isNaN(eventTime)) {
    throw new moleculer.Errors.ValidationError('Invalid event time');
  }
  const currentTime = new Date().getTime();
  const timeDiff = eventTime - currentTime;
  const settings: Setting = await ctx.call('settings.getSettings');
  return timeDiff <= (24*60*60*1000) * settings.maxTimeForRegistration;
}


