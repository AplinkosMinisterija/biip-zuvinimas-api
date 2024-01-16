import Moleculer, { Errors } from 'moleculer';
import { User } from '../services/users.service';
import { FieldHookCallback } from './';

export enum RestrictionType {
  // DEFAULT = USER or ADMIN
  DEFAULT = 'DEFAULT',
  USER = 'USER',
  ADMIN = 'ADMIN',
  PUBLIC = 'PUBLIC',
}

export type Table<
  Fields = {},
  Populates = {},
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Pick<Omit<Fields, P> & Pick<Populates, P>, Extract<P | Exclude<keyof Fields, P>, F>>;

export interface CommonFields {
  createdBy: User['id'];
  createdAt: Date;
  updatedBy: User['id'];
  updatedAt: Date;
  deletedBy: User['id'];
  detetedAt: Date;
}

export interface CommonPopulates {
  createdBy: User;
  updatedBy: User;
  deletedBy: User;
}

export const COMMON_FIELDS = {
  createdBy: {
    type: 'number',
    readonly: true,
    onCreate: ({ ctx }: FieldHookCallback) => ctx?.meta?.user?.id,
    populate: {
      action: 'users.resolve',
      params: {
        scope: false,
      },
    },
  },
  createdAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onCreate: () => new Date(),
  },
  updatedBy: {
    type: 'number',
    readonly: true,
    hidden: 'byDefault',
    onUpdate: ({ ctx }: FieldHookCallback) => ctx?.meta?.user?.id,
    populate: {
      action: 'users.resolve',
      params: {
        scope: false,
      },
    },
  },
  updatedAt: {
    type: 'date',
    columnType: 'datetime',
    hidden: 'byDefault',
    readonly: true,
    onUpdate: () => new Date(),
  },
  deletedBy: {
    type: 'number',
    readonly: true,
    onRemove: ({ ctx }: FieldHookCallback) => ctx?.meta?.user?.id,
    populate: {
      action: 'users.resolve',
      params: {
        scope: false,
      },
    },
  },
  deletedAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onRemove: () => new Date(),
  },
};

export const COMMON_SCOPES = {
  notDeleted: {
    deletedAt: { $exists: false },
  },
};

export const COMMON_DEFAULT_SCOPES = ['notDeleted'];

export function throwNoRightsError(message?: string): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(message || `No rights.`, 401, 'NO_RIGHTS');
}

export enum FishOrigin {
  GROWN = 'GROWN',
  CAUGHT = 'CAUGHT',
}

export enum FishStockingStatus {
  UPCOMING = 'UPCOMING',
  ONGOING = 'ONGOING',
  NOT_FINISHED = 'NOT_FINISHED',
  FINISHED = 'FINISHED',
  INSPECTED = 'INSPECTED',
  CANCELED = 'CANCELED',
}
export enum FishStockingErrorMessages {
  INVALID_ID = 'Invalid fishStocking id',
  INVALID_STATUS = 'Invalid fish stocking status',
  INVALID_EVENT_TIME = 'Invalid event time',
  INVALID_ASSIGNED_TO_ID = 'Invalid "assignedTo" id',
  ASSIGNED_TO_NOT_DEFINED = '"assignedTo" not defined',
  INVALID_FISH_ORIGIN = 'Invalid fish origin',
  INVALID_STOCKING_CUSTOMER = 'Invalid "stockingCustomer" id',
  INVALID_FISH_AGE = 'Invalid "fishAge" id',
  INVALID_FISH_TYPE = 'Invalid "fishType" id',
  INVALID_DELETE_TIME = 'Current time is after permitted deletion time',
}

export const StatusLabels = {
  [FishStockingStatus.UPCOMING]: "Nauja",
  [FishStockingStatus.ONGOING]: "Įžuvinama",
  [FishStockingStatus.CANCELED]: "Atšaukta",
  [FishStockingStatus.FINISHED]: "Įžuvinta",
  [FishStockingStatus.INSPECTED]: "Patikrinta",
  [FishStockingStatus.NOT_FINISHED]: "Neužbaigta"
};
