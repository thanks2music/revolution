import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  query,
  orderBy,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { RssFeed, CreateRssFeedInput, UpdateRssFeedInput } from '../types/rss-feed';

const COLLECTION_NAME = 'rss_feeds';

export class RssFeedService {
  static async createFeed(input: CreateRssFeedInput, userId: string): Promise<RssFeed> {
    console.log('[RssFeedService] createFeed called');
    console.log('[RssFeedService] Input:', input);
    console.log('[RssFeedService] UserId:', userId);

    try {
      const now = new Date();
      const feedData = {
        url: input.url,
        title: input.title || '',
        description: input.description || '',
        siteUrl: input.siteUrl || '',
        isActive: input.isActive ?? true,
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
        createdBy: userId,
        lastFetchedAt: null,
      };

      console.log('[RssFeedService] Feed data prepared:', feedData);
      console.log('[RssFeedService] Firestore db object:', db);
      console.log('[RssFeedService] Collection name:', COLLECTION_NAME);

      const colRef = collection(db, COLLECTION_NAME);
      console.log('[RssFeedService] Collection reference created:', colRef);

      console.log('[RssFeedService] Calling addDoc...');
      const docRef = await addDoc(colRef, feedData);
      console.log('[RssFeedService] Document created with ID:', docRef.id);

      return {
        id: docRef.id,
        ...input,
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      };
    } catch (error) {
      console.error('[RssFeedService] Error in createFeed:');
      console.error('[RssFeedService] Error type:', error?.constructor?.name);
      console.error('[RssFeedService] Error message:', error);
      console.error('[RssFeedService] Error details:', JSON.stringify(error, null, 2));
      throw error;
    }
  }

  static async updateFeed(id: string, input: UpdateRssFeedInput): Promise<void> {
    const docRef = doc(db, COLLECTION_NAME, id);
    const updateData: Record<string, unknown> = {
      ...input,
      updatedAt: Timestamp.fromDate(new Date()),
    };

    await updateDoc(docRef, updateData);
  }

  static async deleteFeed(id: string): Promise<void> {
    const docRef = doc(db, COLLECTION_NAME, id);
    await deleteDoc(docRef);
  }

  static async getFeed(id: string): Promise<RssFeed | null> {
    const docRef = doc(db, COLLECTION_NAME, id);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    const data = docSnap.data();
    return {
      id: docSnap.id,
      url: data.url,
      title: data.title,
      description: data.description,
      siteUrl: data.siteUrl,
      isActive: data.isActive,
      lastFetchedAt: data.lastFetchedAt?.toDate(),
      createdAt: data.createdAt.toDate(),
      updatedAt: data.updatedAt.toDate(),
      createdBy: data.createdBy,
    };
  }

  static async listFeeds(activeOnly = false): Promise<RssFeed[]> {
    let q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));

    if (activeOnly) {
      q = query(
        collection(db, COLLECTION_NAME),
        where('isActive', '==', true),
        orderBy('createdAt', 'desc')
      );
    }

    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        url: data.url,
        title: data.title,
        description: data.description,
        siteUrl: data.siteUrl,
        isActive: data.isActive,
        lastFetchedAt: data.lastFetchedAt?.toDate(),
        createdAt: data.createdAt.toDate(),
        updatedAt: data.updatedAt.toDate(),
        createdBy: data.createdBy,
      };
    });
  }
}