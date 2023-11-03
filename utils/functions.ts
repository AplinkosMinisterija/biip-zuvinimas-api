import { Context } from "moleculer";
import { AuthUserRole, UserAuthMeta } from "../services/api.service";
import { TenantUserRole } from "../services/tenantUsers.service";
import { throwNoRightsError } from "../types";

export const validateCanManageTenantUser = (ctx: Context<any, UserAuthMeta>, err: string) => {
    const { profile } = ctx.meta;
  
    if (
      ctx.meta.authUser?.type === AuthUserRole.USER &&
      ![TenantUserRole.OWNER, TenantUserRole.USER_ADMIN].includes(ctx.meta.user.tenants[profile])
    ) {
      throwNoRightsError(err);
    }
  };
  