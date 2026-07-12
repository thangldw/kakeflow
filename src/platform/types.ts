export interface DatabaseStatusDto {
  readonly healthy: boolean
  readonly schemaVersion: number
}

export interface AppBootstrapDto {
  readonly application: string
  readonly database: DatabaseStatusDto
}

export interface AppHealthDto {
  readonly status: 'ok' | 'degraded'
  readonly database: DatabaseStatusDto
}

export interface AppStatusDto {
  readonly schemaVersion: number
  readonly integrity: 'ok' | 'failed'
}

export interface HouseholdDto {
  readonly id: string
  readonly name: string
  readonly baseCurrency: 'JPY'
  readonly createdAt: string
}

export interface CreateHouseholdInputDto {
  readonly id: string
  readonly name: string
}

export type AppCommand =
  | 'app_bootstrap'
  | 'app_health'
  | 'app_status'
  | 'households_list'
  | 'household_create'

export type Invoke = <T>(command: AppCommand, args?: Record<string, unknown>) => Promise<T>

export interface PlatformClient {
  readonly runtime: 'tauri' | 'web'
  bootstrap(): Promise<AppBootstrapDto>
  health(): Promise<AppHealthDto>
  status(): Promise<AppStatusDto>
  listHouseholds(): Promise<readonly HouseholdDto[]>
  createHousehold(input: CreateHouseholdInputDto): Promise<HouseholdDto>
}
