import json
import urllib.request

BASE = "http://127.0.0.1:4100"
uploads = [
    "http://127.0.0.1:4100/uploads/1780251524042-h2xxhs.png",
    "http://127.0.0.1:4100/uploads/1780251792805-vio2xp.png",
    "http://127.0.0.1:4100/uploads/1780251921112-wu62ap.png"
]


def post(path, data):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        resp_body = resp.read().decode("utf-8")
        print(path, resp.status, resp_body)
        return json.loads(resp_body)["data"]

sport_id = "8e7b5fe8-6a25-4ceb-92f6-7ecddb13a84b"
logo = uploads[0]

country = post("/countries", {
    "name": "Audit Country Visual",
    "iso2Code": "AV",
    "iso3Code": "AVD",
    "flagUrl": logo
})

competition = post("/competitions", {
    "sportId": sport_id,
    "countryId": country["id"],
    "name": "Audit Cup Visual",
    "scope": "domestic",
    "type": "cup",
    "participantType": "clubs",
    "logoUrl": logo
})

club = post("/teams", {
    "sportId": sport_id,
    "countryId": country["id"],
    "name": "Audit Club Visual",
    "type": "club",
    "logoUrl": uploads[1]
})

national = post("/teams", {
    "sportId": sport_id,
    "countryId": country["id"],
    "name": "Audit National Visual",
    "type": "national",
    "logoUrl": uploads[2]
})

print("created", country["id"], competition["id"], club["id"], national["id"])
