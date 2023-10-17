# itten-function

一天Web向けの内部APIです

Firebase Functionsで実行されます。



# Firebase Function

## 開発

https://qiita.com/mashimo_/items/bcca63276dcae3b22f5b

```
firebase login

firebase projects:list
```

プロジェクトを設定する

開発環境（itten-web-dev）

```
firebase use dev
```

本番環境（itten-web）

```
firebase use prd
```



エミュレーター起動

```
firebase emulators:start
```

FunctionsのTypeScriptの変更をウォッチしてビルド

（別のプロンプト）

```
cd functions
npm run build:watch
```



## 環境変数

https://firebase.google.com/docs/functions/config-env?hl=ja&gen=1st#env-variables

`functions/.env`は共通

devの場合

```
firebase use dev
```

-> `/functions/.env.dev`が使われる



本番の場合

```
firebase use prd
```

-> `/functions/.env.prd` が使われる



## デプロイ

環境を設定

```
firebase use dev (or prd)
```

デプロイ

```
firebase deploy --only functions
```

403で失敗することあったけどもっかいやったらできた