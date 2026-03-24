from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    print("Navigating to app...")
    page.goto("http://localhost:5173")
    page.wait_for_timeout(2000)

    print("Clicking Config Tab...")
    page.get_by_text("Config").click()
    page.wait_for_timeout(1000)

    print("Scrolling to Common 3D Rules...")
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.get_by_text("Common 3D Cleanup Rules").scroll_into_view_if_needed()
    page.wait_for_timeout(1000)

    print("Taking screenshot...")
    page.screenshot(path="/tmp/verification3.png")

    context.close()
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
