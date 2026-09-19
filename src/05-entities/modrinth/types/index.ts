export type ModrinthProjectType = 'mod' | 'shader' | 'resourcepack'
export type ModrinthSide = 'required' | 'optional' | 'unsupported'
export type ModrinthVersionType = 'release' | 'beta' | 'alpha'

export interface ModrinthSearchHit {
  project_id: string
  project_type: ModrinthProjectType
  slug: string | null
  author: string | null
  title: string
  description: string
  categories: string[]
  downloads: number
  follows: number
  icon_url: string | null
  date_created: string | null
  date_modified: string | null
  latest_version: string | null
  license: string | null
  client_side: ModrinthSide | null
  server_side: ModrinthSide | null
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[]
  total: number
  offset: number
  limit: number
  version_numbers: Record<string, string>
}

export interface ModrinthLicense {
  id: string
  name: string | null
  url: string | null
}

export interface ModrinthProject {
  id: string
  slug: string | null
  project_type: ModrinthProjectType
  title: string
  description: string
  body: string
  categories: string[]
  downloads: number
  follows: number
  icon_url: string | null
  date_created: string | null
  date_modified: string | null
  license: ModrinthLicense | null
  client_side: ModrinthSide | null
  server_side: ModrinthSide | null
  source_url: string | null
  issues_url: string | null
  wiki_url: string | null
  discord_url: string | null
}

export interface ModrinthVersionFile {
  hashes: Record<string, string>
  url: string
  filename: string
  primary: boolean
  size: number
  file_type: string | null
}

export interface ModrinthDependency {
  version_id: string | null
  project_id: string | null
  file_name: string | null
  dependency_type: string
}

export interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  changelog: string | null
  dependencies: ModrinthDependency[]
  game_versions: string[]
  loaders: string[]
  version_type: ModrinthVersionType
  date_published: string | null
  downloads: number
  featured: boolean
  files: ModrinthVersionFile[]
}

export interface ModrinthProjectDetails {
  project: ModrinthProject
  versions: ModrinthVersion[]
}

export interface ModrinthInstalledMod {
  project_id: string
  slug: string | null
  title: string
  icon_url: string | null
  filename: string
  version_number: string
  sha1: string
}

export interface ModrinthUpdateCheck {
  project_id: string
  current_version: string
  available_version: string | null
}

export interface ModrinthInstallResult {
  installed: string[]
  skipped: string[]
}
