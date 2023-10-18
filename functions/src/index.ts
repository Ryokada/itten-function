import { ClientConfig, TextMessage, TemplateMessage, messagingApi, webhook } from '@line/bot-sdk';
import dayjs from 'dayjs';
import ja from 'dayjs/locale/ja';
import * as admin from 'firebase-admin';
import { DocumentSnapshot, Timestamp, getFirestore } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';
import ScheduleDoc from './types/schedule';

dayjs.locale(ja);

const lineConfig: ClientConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
};

const siteBaseUrl = process.env.SITE_BASE_URL || 'http://localhost:3000';

const client = new messagingApi.MessagingApiClient(lineConfig);
const firebaseAdmin = admin.initializeApp();
const firestoreAdmin = getFirestore(firebaseAdmin);

/**
 * Hello WorldのAPI
 *
 * @deprecated ただのテスト用
 */
export const helloWorld = functions
    .region('asia-northeast1')
    .https.onRequest((request, response) => {
        logger.info('Hello logs!', { structuredData: true });
        response.send(`Hello ${process.env.TEST} from Firebase!!!!!!`);
    });

/**
 * LINEのWebhook用のAPI
 */
export const lineWebhook = functions
    .region('asia-northeast1')
    .https.onRequest(async (request, response) => {
        logger.info('LINE webhook called');

        const callbackRequest: webhook.CallbackRequest = request.body;
        const events: webhook.Event[] = callbackRequest.events ?? [];

        logger.info(
            'LINE webhook abalable events callbackRequest',
            callbackRequest,
            callbackRequest,
        );

        for (const event of events) {
            switch (event.type) {
                case 'message': {
                    if (event.source?.type !== 'user') {
                        logger.info('LINE webhook not user message', event);
                        break;
                    }
                    await client.replyMessage({
                        replyToken: event.replyToken as string,
                        messages: [
                            {
                                type: 'text',
                                text: 'なにもできません',
                            },
                        ],
                    });
                    break;
                }
                default: {
                    logger.info('LINE webhook unknown event', event, event);
                }
            }
        }
        logger.info('LINE webhook done');
        response.send('OK');
    });

type LinePushRequest = {
    toId: string;
};

/**
 * 任意のLINEユーザーまたはグループにメッセージを送信するAPI
 *
 * Request: @see LinePushRequest
 */
export const linePush = functions
    .region('asia-northeast1')
    .https.onRequest(async (request, response) => {
        logger.info('LINE push called');

        const LinePushRequest: LinePushRequest = request.body;

        await client.pushMessage({
            to: LinePushRequest.toId,
            messages: [
                {
                    type: 'text',
                    text: '送信テスト',
                },
            ],
        });

        logger.info('LINE push done');
        response.send('OK');
    });

/**
 * 任意のLINEユーザーまたはグループにメッセージを送信するAPI
 *
 * RequestData: @see LinePushRequest
 */
export const linePushOnCall = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        logger.info('LINE push called', data, context);

        const LinePushRequest: LinePushRequest = data;

        await client.pushMessage({
            to: LinePushRequest.toId,
            messages: [
                {
                    type: 'text',
                    text: '送信テスト',
                },
            ],
        });

        logger.info('LINE push done');
        return {
            OK: 'OK',
        };
    });

type LineSendScheduleMessageRequest = {
    toId?: string;
    scheduleId: string;
};

/**
 * スケジュール追加時にグループLINEで通知するAPI
 */
export const lineSendAddScheduleMessage = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        const linePushRequest: LineSendScheduleMessageRequest = data;
        return await lineSendScheduleMessageCore(linePushRequest, '追加');
    });

/**
 * スケジュール変更時にグループLINEで通知するAPI
 */
export const lineSendChangeScheduleMessage = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        const linePushRequest: LineSendScheduleMessageRequest = data;
        return await lineSendScheduleMessageCore(linePushRequest, '変更');
    });

const lineSendScheduleMessageCore = async (
    lineSendScheduleMessageRequest: LineSendScheduleMessageRequest,
    label: '追加' | '変更',
) => {
    const targetId = lineSendScheduleMessageRequest.toId ?? process.env.LINE_GROUP_ID;
    if (!targetId || !lineSendScheduleMessageRequest.scheduleId) {
        logger.error('必要なパラメータが足りません', lineSendScheduleMessageRequest);
        throw new functions.https.HttpsError('invalid-argument', '必要なパラメータが足りません', {
            key: 'data',
            value: lineSendScheduleMessageRequest,
        });
    }

    const scheduleSnapshot = (await firestoreAdmin
        .collection('schedules')
        .doc(lineSendScheduleMessageRequest.scheduleId)
        .get()) as DocumentSnapshot<ScheduleDoc>;

    const schedule = scheduleSnapshot.data();

    if (!scheduleSnapshot.exists || !schedule) {
        logger.error(
            `指定されたスケジュール${lineSendScheduleMessageRequest.scheduleId}は存在しません`,
        );
        throw new functions.https.HttpsError(
            'invalid-argument',
            `指定されたスケジュール${lineSendScheduleMessageRequest.scheduleId}は存在しません`,
            {
                key: 'scheduleId',
                value: lineSendScheduleMessageRequest.scheduleId,
            },
        );
    }

    logger.info('target schedule', schedule);

    const startTsDayjs = dayjs(getSaftyDate(schedule.startTimestamp));
    const endTsDayjs = dayjs(getSaftyDate(schedule.endTimestamp));

    const scheduleMessage: TemplateMessage = {
        type: 'template',
        altText: `予定が${label}されました（[${startTsDayjs.format(
            'M/D(dd)',
        )}]${schedule?.title}）`,
        template: {
            type: 'buttons',
            title: truncateString(`予定${label}「${schedule.title}」`, 40),
            text: truncateString(
                `${schedule.placeName}[${startTsDayjs.format('M/D(dd)H:mm')}-${endTsDayjs.format(
                    'H:mm',
                )}]`,
                60,
            ),
            actions: [
                {
                    type: 'uri',
                    label: '詳細を見る',
                    uri: `${siteBaseUrl}/member/schedule/${lineSendScheduleMessageRequest.scheduleId}`,
                },
            ],
        },
    };

    const message = await client.pushMessage({
        to: targetId,
        messages: [scheduleMessage],
    });

    logger.info(`LINEで予定${label}メッセージを送信しました`, message);
    return {
        OK: 'OK',
    };
};

/**
 * 出欠回答期限内のスケジュールについてグループLINEで通知するAPI
 */
export const lineSendAnnounceInputSchedule = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        throw new Error('Not implemented');
    });

type LineSendRemindInputScheduleRequest = {
    toIds: string[];
    scheduleId: string;
};

/**
 * 任意のユーザー達ににスケジュールの回答を促すメッセージを送信するAPI
 */
export const lineSendRemindInputSchedule = functions
    .region('asia-northeast1')
    .https.onCall(async (data, context) => {
        const request: LineSendRemindInputScheduleRequest = data;

        if (!request.toIds || !request.scheduleId || request.toIds.length === 0) {
            logger.error('必要なパラメータが足りません', request);
            throw new functions.https.HttpsError(
                'invalid-argument',
                '必要なパラメータが足りません',
                {
                    key: 'data',
                    value: request,
                },
            );
        }

        const scheduleSnapshot = (await firestoreAdmin
            .collection('schedules')
            .doc(request.scheduleId)
            .get()) as DocumentSnapshot<ScheduleDoc>;

        const schedule = scheduleSnapshot.data();

        if (!scheduleSnapshot.exists || !schedule) {
            logger.error(`指定されたスケジュール${request.scheduleId}は存在しません`);
            throw new functions.https.HttpsError(
                'invalid-argument',
                `指定されたスケジュール${request.scheduleId}は存在しません`,
                {
                    key: 'scheduleId',
                    value: request.scheduleId,
                },
            );
        }

        logger.info('target schedule', schedule);

        const startTsDayjs = dayjs(getSaftyDate(schedule.startTimestamp));
        const endTsDayjs = dayjs(getSaftyDate(schedule.endTimestamp));

        const scheduleMessage: TemplateMessage = {
            type: 'template',
            altText: `予定の出欠に回答してください（[${startTsDayjs.format(
                'M/D(dd)',
            )}]${schedule?.title}）`,
            template: {
                type: 'buttons',
                title: truncateString(`予定の出欠に回答してください「${schedule.title}」`, 40),
                text: truncateString(
                    `${schedule.placeName}[${startTsDayjs.format(
                        'M/D(dd)H:mm',
                    )}-${endTsDayjs.format('H:mm')}]`,
                    60,
                ),
                actions: [
                    {
                        type: 'uri',
                        label: '詳細を見る',
                        uri: `${siteBaseUrl}/member/schedule/${request.scheduleId}`,
                    },
                ],
            },
        };

        const message = await client.multicast({
            to: request.toIds,
            messages: [scheduleMessage],
        });

        logger.info(`LINEで予定リマインドメッセージを送信しました`, message);
        return {
            OK: 'OK',
        };
    });

function truncateString(str: string, length = 40): string {
    if (str.length <= length) {
        return str;
    }
    return str.substring(0, length);
}

/**
 * Timestamp から Date を取得する
 *
 * エミュレータだと何故かTimestamp型の情報が不足し、toDate()が使えないので再生成しtoDateを返す
 * @param unsafetyTimestamp
 * @returns
 */
function getSaftyDate(unsafetyTimestamp: Timestamp) {
    let safetyDate;
    try {
        safetyDate = unsafetyTimestamp.toDate();
    } catch (error) {
        if (error instanceof TypeError) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dengerTimestamp: any = unsafetyTimestamp;
            const safetyTimestamp = new Timestamp(
                dengerTimestamp._seconds,
                dengerTimestamp._nanoseconds,
            );
            safetyDate = safetyTimestamp.toDate();
        } else {
            throw error;
        }
    }
    return safetyDate;
}
