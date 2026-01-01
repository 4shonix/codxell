/**
 * Browser Notification Utilities
 */

export async function requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
        console.warn('This browser does not support notifications');
        return 'denied';
    }

    if (Notification.permission === 'granted') {
        return 'granted';
    }

    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission;
    }

    return Notification.permission;
}

export function showNotification(title: string, options?: NotificationOptions) {
    if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            ...options,
        });

        notification.onclick = () => {
            window.focus();
            notification.close();
        };

        return notification;
    }
    return null;
}

export function isTabFocused(): boolean {
    return document.hasFocus();
}
