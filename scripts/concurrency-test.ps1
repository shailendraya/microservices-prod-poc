$endpoint = "http://localhost:4002/graphql"

$requests = @(
    @{ Key = "concurrency-customer-A-001" },
    @{ Key = "concurrency-customer-B-001" }
)

$jobs = foreach ($request in $requests) {
    Start-Job -ArgumentList $endpoint, $request.Key -ScriptBlock {
        param($endpoint, $key)

        $query = @"
mutation ReserveStock(`$key: String!, `$items: [ReservationItemInput!]!) {
  reserveStock(idempotencyKey: `$key, items: `$items) {
    id
    status
    items {
      sku
      quantity
    }
  }
}
"@

        $body = @{
            query = $query
            variables = @{
                key = $key
                items = @(
                    @{
                        sku = "SKU-003"
                        quantity = 2
                    }
                )
            }
        } | ConvertTo-Json -Depth 10

        try {
            $result = Invoke-RestMethod `
                -Uri $endpoint `
                -Method Post `
                -ContentType "application/json" `
                -Body $body

            [PSCustomObject]@{
                RequestKey = $key
                Response = ($result | ConvertTo-Json -Depth 10 -Compress)
            }
        }
        catch {
            [PSCustomObject]@{
                RequestKey = $key
                Response = $_.Exception.Message
            }
        }
    }
}

Wait-Job -Job $jobs | Out-Null
Receive-Job -Job $jobs
Remove-Job -Job $jobs
