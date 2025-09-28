export interface RssFeed {
  id: string;
  url: string;
  title?: string;
  description?: string;
  siteUrl?: string;
  lastFetchedAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface CreateRssFeedInput {
  url: string;
  title?: string;
  description?: string;
  siteUrl?: string;
  isActive?: boolean;
}

export interface UpdateRssFeedInput {
  url?: string;
  title?: string;
  description?: string;
  siteUrl?: string;
  isActive?: boolean;
}