const express = require('express')
const faunadb = require('faunadb'), q = faunadb.query
const fetch = require('node-fetch')
require('dotenv').config()

const FAUNA_DB_SECRET = process.env.FAUNADB_TOKEN
const client = new faunadb.Client({ secret: FAUNA_DB_SECRET })
const app = express()
app.use(express.json())

const PORT = process.env.PORT || 8000
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET

async function get_access_token() {
    const URL = 'https://id.twitch.tv/oauth2/token'

    const params = new URLSearchParams()
    params.append('client_id', TWITCH_CLIENT_ID)
    params.append('client_secret', TWITCH_CLIENT_SECRET)
    params.append('grant_type', 'client_credentials')

    return fetch(URL, {
        method: 'POST',
        body: params
    })
    .then(res => res.status == 200 ? res.json() : null)
    .then(res => res?.access_token)
}

async function get_user(user_name) {
    const token = await get_access_token()
    let user = await cached_user(user_name)
    if(!user) user = await request_user(user_name)
    return user
}

async function cached_user(user_name) {
    if(!user_name || user_name.length === 0) return null
    return client.query(
        q.Get(q.Match(q.Index('user_by_login'), q.Casefold(user_name)))
    ).then(result => result?.data).catch(e => null)
}

async function request_user(user_name) {
    if(!user_name || user_name.length === 0) return
    const token = await get_access_token()
    const TWITCH_USER_ENDPOINT = 'https://api.twitch.tv/helix/users/'
    
    const params = new URLSearchParams()
    params.append('login', encodeURIComponent(user_name))
    return fetch(`${TWITCH_USER_ENDPOINT}?${params.toString()}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Client-Id': TWITCH_CLIENT_ID,
        }
    })
    .then(res => res.status == 200 ? res.json() : null)
    .then(json => json?.data[0])
    .then(user => cache_user(user))
}

async function cache_user(user) {
    if(!user) return
    client.query(
         q.Let({
            match: q.Match(q.Index('user_by_id'), user.id),
            data: { ttl: q.Time(new Date(Date.now() + (1000 * 60 * 60)).toISOString()), data: user }
            },
            q.If(
                q.Exists(q.Var('match')),
                q.Update(q.Select('ref', q.Get(q.Var('match'))), q.Var('data')),
                q.Create(q.Collection('users'), q.Var('data'))
            )
        )
    )
    return user
}

function rand_int(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function neighbouring_key(key) {
    const is_upper = key === key.toUpperCase()
    key = key.toLowerCase()
    const keys = [
        'qwertyuiop',
        'asdfghjkl;',
        'zxcvbnm,./'
    ]

    let row = -1
    let col = -1

    for(let r = 0; r < keys.length; r++) {
        const i = keys[r].indexOf(key)
        if(i == -1) continue
        row = r
        col = i
    }

    if(row == -1 || col == -1) return key
    let row_min = row == 0 ? 0 : -1
    let row_max = row == 2 ? 0 : 1
    let rand_row = row + rand_int(row_min, row_max)
    let col_min = col == 0 ? 0 : -1
    let col_max = col == (keys[0].length - 1) ? 0 : 1
    let rand_col = col + rand_int(col_min, col_max)

    key = keys[rand_row][rand_col]

    return is_upper ? key.toUpperCase() : key
}

function drunkenify(text, drunk_factor = 0.9) {
    return Array.from(text).map(x => {
        if(Math.random() <= drunk_factor) return x
        const r = Math.random()
        if(x == ' ') return r <= 0.5 ? '' : '  '
        return r < 0.05 ? '' : r < 0.4 ? neighbouring_key(x) : r < 0.8 ? x.toUpperCase() : x.repeat(rand_int(0, 4))
    }).join('')
}

app.get('/twitch/user/:user', (req, res) => {
    console.log(req.params)
    if(!req.params.user) return
    console.log(res)
    get_user(req.params.user).then(user => res.send(user))
})
app.get('/twitch/user/:user/description', (req, res) => {
    if(!req.params.user) return
    get_user(req.params.user).then(user => res.send(user?.description))
})
app.get('/twitch/user/:user/force_update', (req, res) => {
    if(!req.params.user) return
    request_user(req.params.user).then(user => res.send(user))
})
app.get('/twitch/user/:user/broadcaster_type', (req, res) => {
    if(!req.params.user) return
    request_user(req.params.user).then(user => res.send(user?.broadcaster_type))
})
app.get('/twitch/user/:user/drunk_description/:factor', (req, res) => {
    if(!req.params.user) return
    request_user(req.params.user)
        .then(user => res.send(drunkenify(user?.description, req.params.factor)))
})
app.listen(PORT)