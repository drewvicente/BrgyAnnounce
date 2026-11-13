import { formatDate } from '@angular/common';
import { Injectable, computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';

import { APP_CONFIG } from '../core/app-config';
import { loadData, saveData } from '../core/local-store';
import type { Notice, Reminder } from '../models/notice.model';

const KEY = 'barangay.reminders';
const CHANNEL_ID = 'reminders_v2'; // channel with sound + vibration
type AddResult = 'ok' | 'past' | 'no-date' | 'denied';

// Reminders are saved on the resident's own phone, so residents need no account.
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly _list = signal<Reminder[]>(this.loadUpcoming());

  readonly list = computed((): Reminder[] =>
    [...this._list()].sort((a, b) => a.remindAt.localeCompare(b.remindAt))
  );
  readonly count = computed((): number => this._list().length);

  has(noticeId: string): boolean {
    return this._list().some(r => r.noticeId === noticeId);
  }

  // Tap once to set, tap again to cancel. Returns a message to show in a toast.
  async toggle(notice: Notice): Promise<string> {
    if (this.has(notice.id)) {
      await this.cancel(notice.id);
      await this.buzz('cancel');
      return 'Reminder cancelled';
    }
    const result = await this.add(notice);
    if (result === 'ok') {
      await this.buzz('set');
      return 'Reminder set for the event time';
    }
    await this.buzz('error');
    switch (result) {
      case 'past':
        return 'This event has already started';
      case 'no-date':
        return 'This notice has no event date';
      default:
        return 'Allow notifications to get reminders';
    }
  }

  async cancel(noticeId: string): Promise<void> {
    const found = this._list().find(r => r.noticeId === noticeId);
    if (!found) {
      return;
    }
    this._list.update((list): Reminder[] => list.filter(r => r.noticeId !== noticeId));
    saveData(KEY, this._list());

    if (Capacitor.isNativePlatform()) {
      try {
        await LocalNotifications.cancel({ notifications: [{ id: found.notificationId }] });
      } catch {
        // nothing to cancel
      }
    }
  }

  private async add(notice: Notice): Promise<AddResult> {
    if (!notice.eventDate) {
      return 'no-date';
    }

    // "On time" = the event's own date and time.
    const remindAt = new Date(notice.eventDate);
    if (remindAt.getTime() <= Date.now()) {
      return 'past';
    }

    const notificationId = Math.floor(Math.random() * 2_000_000_000) + 1;

    // Real phone notification only works inside the Android app.
    // In the browser the reminder is saved but nothing pops up.
    if (Capacitor.isNativePlatform()) {
      try {
        const perm = await LocalNotifications.requestPermissions();
        if (perm.display !== 'granted') {
          return 'denied';
        }
        await this.ensureChannel();
        const time = formatDate(notice.eventDate, 'h:mm a', 'en-US');
        const place = notice.location ? ` at ${notice.location}` : '';

        // Schedule the notification for the event's own date and time.
        await LocalNotifications.schedule({
          notifications: [
            {
              id: notificationId,
              channelId: CHANNEL_ID,
              title: APP_CONFIG.shortName,
              body: `${notice.title} is starting now, ${time}${place}`,
              schedule: { at: remindAt, allowWhileIdle: true },
            },
          ],
        });




        
      } catch {
        return 'denied';
      }
    }

    const reminder: Reminder = {
      noticeId: notice.id,
      title: notice.title,
      eventDate: notice.eventDate,
      remindAt: remindAt.toISOString(),
      notificationId,
    };
    this._list.update((list): Reminder[] => [...list, reminder]);
    saveData(KEY, this._list());
    return 'ok';
  }

  // Short vibration on the phone when the resident taps Remind. Does nothing in the browser.
  private async buzz(kind: 'set' | 'cancel' | 'error'): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      if (kind === 'set') {
        await Haptics.notification({ type: NotificationType.Success });
      } else if (kind === 'cancel') {
        await Haptics.impact({ style: ImpactStyle.Light });
      } else {
        await Haptics.notification({ type: NotificationType.Error });
      }
    } catch {
      // phone has no vibration motor
    }
  }

  // Android keeps a channel's sound/vibration settings once created,
  // so vibration has to be set when the channel is first made.
  private async ensureChannel(): Promise<void> {
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'Event reminders',
        description: 'Reminders for barangay events',
        importance: 5, // high: sound + vibration + pop-up
        visibility: 1,
        vibration: true,
      });
    } catch {
      // channel already exists
    }
  }

  // forget reminders whose event already happened
  private loadUpcoming(): Reminder[] {
    const all = loadData<Reminder[]>(KEY, []);
    const upcoming = all.filter(r => new Date(r.eventDate).getTime() > Date.now());
    if (upcoming.length !== all.length) {
      saveData(KEY, upcoming);
    }
    return upcoming;
  }
}