import { ClientConfig, messagingApi, webhook } from '@line/bot-sdk';
import * as functions from 'firebase-functions';
import * as logger from 'firebase-functions/logger';

const lineConfig: ClientConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
};

const client = new messagingApi.MessagingApiClient(lineConfig);

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
